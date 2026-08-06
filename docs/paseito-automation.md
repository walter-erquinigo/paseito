# Paseito automation

Paseito is maintained as a fail-closed, Apple Silicon macOS fork. Its machine branch is `paseito`,
the upstream remote is `getpaseo/paseo`, and `automation/upstream.json` records the peeled stable
upstream commit represented by the branch.

## No-fee boundary

- The repository must remain public. Paseito workflows refuse to run for a private repository.
- Release builds use GitHub's standard public `macos-14` arm64 runner. Sanitized installation
  status uses a standard public Ubuntu runner; email reporting runs only on the enrolled Mac.
- Releases are unsigned. The local installer applies an ad-hoc signature after verification;
  Apple Developer membership and notarization are intentionally excluded.
- Email reporting uses NVIDIA's authenticated SMTP relay over STARTTLS. Its password is read from
  the macOS login Keychain and never copied into GitHub, a plist, a repository file, or a log.
- Artifact retention is deliberately small. The daily date key is private local state. No
  third-party build, signing, updater, or email service is used.

## Local semantic release invariant

At 18:00 America/New_York each day, a macOS LaunchAgent refreshes
a controller-owned checkout and prepares a disposable candidate against the exact peeled stable
`vMAJOR.MINOR.PATCH` upstream commit. A private success date prevents duplicate checks; failures retry
hourly. The controller owns
Git's mechanical rebase, staging, and commit operations; local Codex resolves each paused conflict
semantically and then reconciles feature behavior in the rebased worktree.
The feature registry records intent, invariants, contracts, paths, and whether a feature is
permanent. Codex classifies every feature as `carry_forward`, `adapt`, `upstream_complete`, or
`blocked`. It may retire a non-permanent feature only when upstream independently satisfies every
invariant and executable contract. A changelog or similarly named upstream feature is not proof.

A second, read-only Codex invocation independently reviews the committed candidate and its evidence.
Both invocations run without GitHub or API-token environment variables and have no promotion role.
The controller then runs local formatting, lint, and focused contract checks before pushing only an
ephemeral candidate branch.

GitHub Actions never rebases, resolves conflicts, retires features, advances `paseito`, creates a
tag, publishes a release, or installs the app. Separate macOS arm64 and Linux x64 jobs check out the
exact candidate SHA with persisted credentials disabled. They repeat deterministic tests, build the
unsigned desktop app and self-contained daemon runtime, and smoke-test each artifact. A final job
emits provenance only after both jobs succeed. The local controller verifies the artifact set and
advances the branch and annotated tag atomically with `--force-with-lease`. It then uploads the
release, runs the local installer, and makes one deployment attempt for each registered remote host.

A conflict, blocked decision, rejected independent review, failed check, rejected lease, or artifact
mismatch leaves the last published app installable. Before promotion, the controller writes a
private pending record. A later scheduled run resumes release upload and installation only when the
remote branch, peeled tag, candidate commit, artifacts, checksum, and provenance still agree.

Each release publishes:

- the unsigned arm64 ZIP;
- the self-contained Linux x64 daemon archive;
- an exact SHA-256 checksum file for each artifact;
- `provenance.json`, binding the upstream tag and commit, Paseito commit, workflow run,
  architectures, version, artifact digests, semantic decisions, and verification results.

Linux daemon manifests retain the legacy singular `feature` field for old deployers and add a
`features` list for capability-complete releases. New Paseito releases require the base selector,
on-demand Changes context, and structured review-suggestion capabilities to be present together.

## Registered remote hosts

Remote deployment is local and opt-in. The private mode-0600 registry at
`~/Library/Application Support/PaseitoAutomation/remote-hosts.json` lists exact SSH targets, Node
binaries, runtime roots, systemd user units, daemon homes, and listen addresses. The tracked
`automation/remote/remote-hosts.example.json` documents the schema. A release is never discovered,
rebased, or selected independently on a remote host; the deployer accepts only the Linux artifact
bound into the promoted candidate's provenance.

The deployer stages under the registered runtime root, checks the archive digest and manifest, and
refuses cutover while an agent has an active foreground turn. Otherwise it atomically switches the
`current` symlink and service unit and verifies the live version, PID, server ID, websocket status,
and relay connection. It retains the existing `~/.paseo`, port, and server identity. A failed
post-cutover check restores the previous unit and runtime. Remote failure does not undo an already
successful Mac release, is not automatically retried, and is written to
`remote-deployment-state.json` for the daily report. A later release or an explicit manual deploy is
required for another attempt.

## Installer and local watcher

`automation/launchagents/install_launchagents.py` installs two user LaunchAgents. The semantic
watcher launches at the top of every hour and gates itself at 18:00 America/New_York, including DST changes, while local email reporting
uses its separate daily gate. The small sync watcher updates a marked private control checkout under
`~/Library/Application Support/PaseitoAutomation`, runs the semantic controller from that checkout,
and relies on the user's existing Codex and GitHub CLI sessions. No token is copied into a plist or
candidate checkout. Only fixed-field sanitized status is dispatched to GitHub.

The installer never stops Paseito. When the app is running, it installs the verified update, keeps
the previous known-good app, writes a pending-restart marker, and displays a notification. Failures
before a verified replacement preserve the installed app, and an interrupted rollback preserves
the private recovery directory instead of deleting the previous app.

## Migration

`automation/migration/migrate_from_paseo.py` is dry-run-first. Its receipt binds the exact current
allowlist, and `--apply` rejects a stale or missing receipt. Both applications and daemons must be
stopped. The migration backs up existing Paseito state, stages only allowlisted Electron and daemon
data, removes caches and identity material, rewrites the daemon home/listen configuration, creates
a fresh server id, and lets the first Paseito start create a fresh daemon keypair. Replacement of
the application and daemon trees is rolled back as a unit on failure. Chromium LevelDB transaction
logs are preserved because they are database state, not diagnostic logs. A hidden local Electron
bridge translates storage from the `paseo://app` origin to `paseito://app`, retains remote host
pairings and cached workspaces, replaces the old local daemon identity with Paseito's fresh identity,
and fails before handoff if the translated host registry cannot be verified.

External agent CLI credential homes are reused in place and never copied. Chromium cookies are a
best-effort surface because application identity can require reauthentication.

## Daily report

The local reporting agent checks hourly. `zoneinfo` selects the first run at or after 07:00 New York,
and a mode-0600 local date key suppresses duplicates while allowing catch-up after sleep. The report
includes the latest semantic classifications, independent review, deterministic build, publication,
local installation, the most recent result for every registered remote host, and any unresolved
controller failure. Email transport failure updates a persistent issue and fails visibly; the next
hourly run retries.

Bootstrap steps are in `automation/reporting/README.md`. The NVIDIA password must be entered directly
into macOS Keychain and the relay requires the Mac to be on-premises or connected to VPN.
