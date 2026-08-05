# Paseito automation

Paseito is maintained as a fail-closed, Apple Silicon macOS fork. Its machine branch is `paseito`,
the upstream remote is `getpaseo/paseo`, and `automation/upstream.json` records the peeled stable
upstream commit represented by the branch.

## No-fee boundary

- The repository must remain public. Paseito workflows refuse to run for a private repository.
- Release builds use GitHub's standard public `macos-14` arm64 runner. Reporting and status use
  standard public Ubuntu runners.
- Releases are unsigned. The local installer applies an ad-hoc signature after verification;
  Apple Developer membership and notarization are intentionally excluded.
- Microsoft Graph reporting uses delegated `Mail.Send` and `offline_access`. It requires a free
  public-client app registration and one local device-code login, not a paid mail service.
- Artifact retention is deliberately small except for the encrypted Graph token cache and daily
  date key. No third-party build, signing, updater, or email service is used.

## Local semantic release invariant

An hourly macOS LaunchAgent refreshes a controller-owned checkout and prepares a disposable
candidate against the exact peeled stable `vMAJOR.MINOR.PATCH` upstream commit. The controller owns
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
tag, publishes a release, or installs the app. It checks out the exact candidate SHA with persisted
credentials disabled, repeats deterministic tests, builds the unsigned arm64 app, and emits a
short-lived artifact plus provenance. The local controller verifies that artifact and advances the
branch and annotated tag atomically with `--force-with-lease`. It then uploads the release and runs
the local installer.

A conflict, blocked decision, rejected independent review, failed check, rejected lease, or artifact
mismatch leaves the last published app installable. Before promotion, the controller writes a
private pending record. A later hourly run resumes release upload and installation only when the
remote branch, peeled tag, candidate commit, artifacts, checksum, and provenance still agree.

Each release publishes only:

- the unsigned arm64 ZIP;
- the exact SHA-256 checksum file;
- `provenance.json`, binding the upstream tag and commit, Paseito commit, workflow run,
  architecture, version, artifact digest, semantic decisions, and verification results.

## Installer and local watcher

`automation/launchagents/install_launchagents.py` installs one hourly user LaunchAgent. Its small
watcher updates a marked private control checkout under
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
the application and daemon trees is rolled back as a unit on failure.

External agent CLI credential homes are reused in place and never copied. Chromium cookies are a
best-effort surface because application identity can require reauthentication.

## Daily report

The daily workflow runs at both UTC offsets that can correspond to 07:00 New York. `zoneinfo`
selects the actual local hour, and an encrypted artifact stores the last-sent New York date to
suppress duplicates. The report includes the latest semantic classifications, independent review,
deterministic build, publication, local installation, and any unresolved controller failure. Email
transport failure updates a persistent issue and fails visibly.

Bootstrap steps are in `automation/reporting/README.md`. The device-code login must remain local so
its authorization code never appears in a public Actions log.
