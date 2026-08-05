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

## Release invariant

The hourly workflow filters upstream releases to exact stable `vMAJOR.MINOR.PATCH` tags, peels the
tag to a commit, rebases a temporary candidate, and verifies that candidate. It advances `paseito`
with `--force-with-lease` and creates an annotated `paseito-v...` tag only after formatting, lint,
typechecking, focused tests, packaging, the packaged desktop smoke test, and arm64 inspection pass.

A conflict, failed check, rejected lease, or artifact mismatch leaves the last published app
installable. The workflow records diagnostics and updates one deduplicated failure issue. If tag
publication succeeds but GitHub Release asset upload is interrupted, a rerun accepts the existing
tag only when both the peeled tag and remote branch equal the newly verified commit, then resumes
asset upload.

Each release publishes only:

- the unsigned arm64 ZIP;
- the exact SHA-256 checksum file;
- `provenance.json`, binding the upstream tag and commit, Paseito commit, workflow run,
  architecture, version, artifact digest, and verification results.

## Installer and local watchdog

`automation/launchagents/install_launchagents.py` installs two hourly user LaunchAgents. One polls
and verifies releases before atomically replacing `/Applications/Paseito.app`; the other restores
the release workflow if GitHub disables scheduled workflows after repository inactivity. Neither
agent stores a credential. They reuse the local GitHub CLI credential from macOS Keychain and send
only the fixed-field sanitized installation status.

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
suppress duplicates. Email transport failure updates a persistent issue and fails visibly.

Bootstrap steps are in `automation/reporting/README.md`. The device-code login must remain local so
its authorization code never appears in a public Actions log.
