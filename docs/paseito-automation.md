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

At 07:00 America/New_York each Sunday, a macOS LaunchAgent opens a visible iTerm2 window and starts an
interactive Codex session in the enrolled source checkout. It does not run at install time and does
not retry unattended. An advisory lock prevents overlapping weekly sessions. Failures remain visible
in iTerm2 so the human can supply credentials, resolve ambiguity, or stop the run. The launcher uses
LaunchServices and iTerm2's `--command` entrypoint; launchd-owned AppleEvents are rejected by macOS
automation privacy controls.

Before inspecting a new upstream release, the session classifies every local commit with a registry
feature ID, creates a recoverable backup ref, splits mixed commits, and folds related fixes into their
owning feature. The approved source tree must remain unchanged apart from intentional registry,
workflow, checklist, and version edits. The history check requires exactly one commit per registered
feature and permits release metadata as a separate operational commit.

The prompt then requires focused tests, formatting, typechecking, and linting before publication.
Release discovery compares checked-in Paseito metadata with published provenance so a pushed revision
that has not been released remains eligible even when the upstream tag has not changed.
Before rebasing, it compares every registered feature and preservation fix with the exact peeled
stable `vMAJOR.MINOR.PATCH` upstream commit. When upstream implements all or part of a local feature,
the session shows the feature ID, evidence, and remaining differences, then waits for the human to
choose carry-forward, adaptation, or retirement. It never infers that choice from passing tests or
apparent equivalence. After those decisions, it performs the semantic rebase while preserving the
feature registry and local work. Successful runs push the branch, publish and verify a release,
install it locally, and deploy registered remote daemons only after explicit restart approval.
Restarting either a desktop-managed or remote daemon requires permission because it interrupts active
agents.

The retained semantic controller remains the implementation available to the interactive session when
its fail-closed candidate workflow is appropriate. The controller owns
Git's mechanical rebase, staging, and commit operations; Codex resolves each paused conflict
semantically and then reconciles feature behavior in the rebased worktree.
The feature registry records each canonical commit subject and preservation fixes alongside intent,
invariants, contracts, paths, and whether a feature is permanent. It generates the concise local
feature checklist in `AGENTS.md`; a validation check rejects checklist drift. Local finalization adds
a `Paseito-Change` trailer and refuses to combine work spanning multiple registry features. The
semantic controller validates normalized history before starting its mechanical rebase and again
after semantic reconciliation, before independent review or promotion. Codex classifies every
feature as `carry_forward`, `adapt`, `upstream_complete`, or `blocked`. It may retire a non-permanent
feature only when upstream independently satisfies every invariant and executable contract. A
changelog or similarly named upstream feature is not proof.

A second, read-only Codex invocation independently reviews the committed candidate and its evidence.
Both invocations run without GitHub or API-token environment variables and have no promotion role.
The write pass may repair its own structured blockers twice in the same private candidate. Browser
contracts that cannot bind a loopback listener in the sandbox are the only checks it may defer; the
controller accepts only exact registry commands, runs them outside the sandbox, and records their
full result before independent review. A real browser failure is returned to the remaining semantic
repair attempts with its transcript; exhausting those attempts still stops before review or push.
The controller then runs local formatting, lint, and focused contract checks before pushing only an
ephemeral candidate branch.

GitHub Actions never rebases, resolves conflicts, retires features, advances `paseito`, creates a
tag, publishes a release, or installs the app. Separate macOS arm64 and Linux x64 jobs check out the
exact candidate SHA with persisted credentials disabled. They repeat deterministic tests, build the
unsigned desktop app and self-contained daemon runtime, and smoke-test each artifact. A final job
emits provenance only after both jobs succeed. The local controller verifies the artifact set and
advances the branch and annotated tag atomically with `--force-with-lease`. It uploads the release,
re-downloads every asset, and verifies the published bytes before running the local installer. Remote
deployment stays deferred unless the controller invocation records explicit restart approval.

The `paseito` branch is intentionally replaceable because semantic rebases rewrite its history.
Annotated `paseito-v*` release tags and `paseito-recovery-*` snapshots are immutable under the GitHub
tag ruleset and retain every deployed source commit across later rebases. This protects against source
checkout, server and branch loss inside the single canonical GitHub fork; repository or account loss
is outside this durability boundary.

When GitHub rejects a run because the monthly Actions quota or spending limit is exhausted, the
interactive session stops using Actions for that run. It completes focused and required checks on
the enrolled Mac, builds and verifies the Apple Silicon app locally, commits the final version,
updates `paseito` with `--force-with-lease`, and installs the local build. It does not create a tag,
publish provenance or release assets, or deploy remote daemons because Linux x64 verification is
unavailable. Those publication steps wait for a later run with Actions capacity. A human can also
declare Actions unavailable when manually restarting the weekly launcher; the current run then uses
the same fallback without dispatching a probe workflow.

A conflict, blocked decision, rejected independent review, failed check, rejected lease, or artifact
mismatch leaves the last published app installable. Before promotion, the controller writes a
private pending record. A later scheduled run resumes release upload and installation only when the
remote branch, peeled tag, candidate commit, artifacts, checksum, and provenance still agree.

Each release publishes:

- the unsigned arm64 ZIP;
- the self-contained Linux x64 daemon archive;
- an exact SHA-256 checksum file for each artifact;
- `provenance.json`, binding the upstream tag and commit, Paseito commit, immutable release tag,
  workflow run, architectures, version, artifact and runtime-manifest digests, semantic decisions,
  and verification results.

Linux daemon manifests retain the legacy singular `feature` field for old deployers and add a
`features` list for capability-complete releases. New Paseito releases require the base selector,
on-demand Changes context, structured review suggestions, branch-file review-state, and the
workspace editor-LSP capability, including the daemon-owned clangd fallback, to be present
together.

## Registered remote hosts

Remote deployment is local and opt-in. The private mode-0600 registry at
`~/Library/Application Support/PaseitoAutomation/remote-hosts.json` lists exact SSH targets, Node
binaries, runtime roots, systemd user units, daemon homes, and listen addresses. The tracked
`automation/remote/remote-hosts.example.json` documents the schema. A release is never discovered,
rebased, or selected independently on a remote host; the deployer accepts only the Linux artifact
bound into the promoted candidate's provenance.

The deployer first resolves the provenance commit through its immutable GitHub tag, downloads the
published Linux artifact, checksum and provenance, and compares them with the controller's copies.
The artifact's schema-v3 manifest binds its source repository, commit, release tag and deterministic
inventory of every runtime file and symlink.

Before upload or restart, the deployer verifies the active runtime inventory, the registered systemd
unit and absence of drop-ins. Any drift reports the affected paths and stops without changing the
host. A verified release is made read-only, then the deployer refuses cutover while an agent has an
active foreground turn. With explicit `--restart-approved`, it atomically switches the `current`
symlink and service unit and verifies the live version, PID, server ID, websocket status, and relay
connection. It retains the existing `~/.paseo`, port, and server identity. A failed post-cutover check
restores the previous unit and runtime. Every attempt is mirrored to the GitHub Deployments API and
written to `remote-deployment-state.json`; failures are not retried automatically.

A pre-schema-v3 runtime cannot prove that it is unchanged. The first hardened deployment must compare
that live tree with a fresh build of its recovery-tagged commit, then name the exact commit through
`--allow-legacy-current-commit`. That exception applies to one known current runtime only; later
deployments always require the embedded inventory.

## Installer and local watcher

`automation/launchagents/install_launchagents.py` installs two user LaunchAgents. The weekly release
agent uses launchd's Sunday 07:00 calendar schedule and opens iTerm2; local email reporting uses its
separate daily gate. The installer removes and boots out the legacy unattended semantic-sync agent.
The interactive session relies on the user's existing Codex and GitHub CLI sessions. No token is copied
into a plist or candidate checkout. Only fixed-field sanitized status is dispatched to GitHub.

The source checkout and semantic controller are separate on purpose. After promotion rewrites the
published branch, the watcher records a private pending sync, creates a recoverable backup ref, and
uses `git reset --keep` to align the source branch without discarding concurrent uncommitted edits.
Unexpected branch divergence or overlapping edits stop the run for manual review.

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

The local reporting agent checks hourly. `zoneinfo` selects the first run at or after 08:00 New York,
and a mode-0600 local date key suppresses duplicates while allowing catch-up after sleep. The report
includes the latest semantic classifications, independent review, deterministic build, publication,
local installation, the most recent result for every registered remote host, and any unresolved
controller failure. Email transport failure updates a persistent issue and fails visibly; the next
hourly run retries.

Bootstrap steps are in `automation/reporting/README.md`. The NVIDIA password must be entered directly
into macOS Keychain and the relay requires the Mac to be on-premises or connected to VPN.
