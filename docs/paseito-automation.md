# Paseito automation

Paseito is maintained as a fail-closed Apple Silicon macOS fork. Its machine branch is `paseito`,
the upstream remote is `getpaseo/paseo`, and `automation/upstream.json` records the peeled stable
upstream commit represented by the branch.

GitHub is a source transport only. The maintenance path fetches upstream and force-pushes the
normalized `paseito` branch with a lease. It never dispatches GitHub Actions, creates Paseito release
tags, publishes releases or provenance, uploads assets, posts automation status, or deploys remote
daemons.

## Interactive maintenance invariant

At 07:00 America/New_York each Sunday, a macOS LaunchAgent opens a visible iTerm2 window and starts
an interactive Codex session in the enrolled source checkout. It does not run at install time or
retry unattended. An advisory lock prevents overlapping weekly sessions. Failures remain visible in
iTerm2 so the human can supply credentials, resolve ambiguity, or stop the run. The launcher uses
LaunchServices and iTerm2's `--command` entrypoint because launchd-owned AppleEvents are rejected by
macOS automation privacy controls.

Before inspecting a new upstream release, the session classifies every local commit with a registry
feature ID, creates a recoverable backup ref, splits mixed commits, and folds related fixes into their
owning feature. The approved source tree must remain unchanged apart from intentional registry,
workflow, checklist, and version edits. The history check requires exactly one commit per registered
feature and permits release metadata as a separate operational commit.

The session runs focused tests, formatting, typechecking, and linting before it fetches and compares
the latest peeled stable `vMAJOR.MINOR.PATCH` upstream release. When upstream implements all or part
of a local feature, it shows the feature ID, evidence, and remaining differences, then waits for the
human to choose carry-forward, adaptation, or retirement. Passing tests, similar names, or apparent
equivalence cannot make that choice. The semantic rebase preserves every unretired registered
feature.

The semantic controller owns Git's mechanical rebase, staging, and commit operations. Codex resolves
paused conflicts and reconciles feature behavior in the rebased worktree. The feature registry
records canonical commit subjects, preservation fixes, intent, invariants, contracts, paths, and
permanence. It generates the concise checklist in `AGENTS.md`; validation rejects checklist drift.
Local finalization adds a `Paseito-Change` trailer and refuses to combine work spanning multiple
registry features.

The controller validates normalized history before mechanical rebase and after semantic
reconciliation. When the source already contains the exact peeled stable upstream commit, it checks
history against that commit and skips replay. Human-approved classifications are binding; missing,
duplicate, unknown, or reclassified decisions stop the run. A non-permanent feature may be retired
only when upstream independently satisfies every invariant and executable contract.

A second read-only Codex invocation reviews the committed candidate and its evidence. Both Codex
passes run without GitHub or API-token environment variables and have no Git authority. The write
pass may repair structured blockers twice. Only exact registry browser contracts blocked before
execution by the sandbox's loopback restriction may be handed to the controller. The controller runs
each handed-off command locally and records its complete result before review.

After review, the controller writes the next numeric `paseito.N` version and decision record, reruns
all focused and repository-required checks, and builds the unsigned arm64 app locally. The packaged
smoke uses isolated homes and ports, starts and stops only its isolated daemon, checks the renderer,
preload bridge, bundled CLI, terminal path, and desktop-managed daemon, and never touches the daemon
on port 6767. The controller verifies the local bundle ID, visible version, and arm64-only executable
before updating `fork/paseito` with `--force-with-lease`.

No cross-platform verification or Linux release artifact exists in this policy. Remote daemon
deployment is unavailable. The local branch and recoverable backup refs are the retained source
history; there is no immutable release tag or published artifact archive.

## Local installation

`automation/installer/paseito_installer.py` accepts the verified local `Paseito.app` and exact
version. It rechecks bundle identity, version, and architecture, applies an ad-hoc signature, removes
quarantine, atomically replaces `/Applications/Paseito.app`, and retains the previous known-good app.
It has no network or GitHub status path.

The installer never stops Paseito. When the app is running, it writes a pending-restart marker and
displays a notification. Quitting Paseito or restarting its desktop-managed daemon requires separate
human permission because active agents will be interrupted. A newly installed bundle is not active
until the running GUI bundle path, visible version, and `daemonNode` path have been checked after that
approved restart.

## Source checkout watcher

The source checkout and semantic candidate are separate. After the controller rewrites the remote
branch, the watcher records a private pending sync, creates a recoverable backup ref, and uses
`git reset --keep` to align the source branch without discarding concurrent uncommitted edits.
Unexpected branch divergence or overlapping edits stop for manual review.

## Migration

`automation/migration/migrate_from_paseo.py` is dry-run-first. Its receipt binds the exact current
allowlist, and `--apply` rejects a stale or missing receipt. Both applications and daemons must be
stopped. The migration backs up existing Paseito state, stages only allowlisted Electron and daemon
data, removes caches and identity material, rewrites the daemon home/listen configuration, creates a
fresh server ID, and lets the first Paseito start create a fresh daemon keypair. Application and
daemon tree replacement rolls back as a unit on failure.

External agent CLI credential homes are reused in place and never copied. Chromium cookies remain a
best-effort surface because application identity can require reauthentication.

## Daily report

The local reporting agent checks hourly. `zoneinfo` selects the first run at or after 08:00 New York,
and a mode-0600 local date key suppresses duplicates while allowing catch-up after sleep. The report
reads checked-in upstream metadata, the latest semantic decision, the source version, the installed
bundle, and pending-restart state. It does not query Actions, releases, provenance, deployments, or
GitHub issues. Email transport failures remain in the local LaunchAgent log and retry on the next
hourly run.

Bootstrap steps are in `automation/reporting/README.md`. The NVIDIA password must be entered directly
into macOS Keychain, and the relay requires the Mac to be on-premises or connected to VPN.

