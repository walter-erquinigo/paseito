# Paseito MR tracker

The MR tracker is a desktop-client feature for monitoring GitLab merge requests. It does not add a daemon capability and does not run on remote Paseito hosts. The renderer handles a token only while the user types and submits it; desktop-main persistence never returns the stored token to renderer state.

## Surface

Electron builds show an **MRs** section above **Workspaces** with **All**, **My MRs**, and **Others** views. The section gear opens **Settings → MRs**. The views are read-only: they can open an MR in GitLab, add or remove a local tracked-MR record, and set local importance, but they never mutate GitLab.

Each refresh discovers open MRs authored by the configured user and additional exact usernames, optionally includes MRs where the configured user is a reviewer, and includes manually tracked MRs. Results are grouped into per-project stacks by matching a child MR's target branch to another MR's source branch. A filtered tab retains out-of-tab ancestors as stack context. Local triage is binary: **Important** or **Ignore**. The toolbar can show only Important MRs; legacy Later and Ignore values both load as Ignore.

The fixed refresh cadence is two minutes. The first successful refresh establishes a silent notification baseline. Later complete refreshes can notify for a newly discovered owned MR, an MR becoming ready, or a new failed pipeline. Partial refreshes preserve cached data and do not advance notification transitions.

Readiness uses generic GitLab facts only: open non-draft state, mergeable status, successful latest overall GitLab pipeline, required approvals satisfied, no merge conflict, and resolved blocking discussions. Product-specific CI, Jira, trusted-bot, and automation rules from the former MR Tracker application are deliberately excluded.

## Credentials and persistence

Settings store the GitLab base URL, username, additional usernames, reviewer preference, and authentication-header type in `mr-tracker.json` under Electron's stable Paseito `userData` directory. After submission, the access token is never written to that JSON file, returned over desktop IPC, logged, or included in an error.

The token is stored separately as `mr-tracker-token` with owner-only mode `0600` in Paseito's local application-data directory. Paseito deliberately does not use macOS Keychain. This keeps credentials out of the public repository and other user accounts, but it does not encrypt the token against software running as the same macOS user. Removing the token in settings deletes this file.

The desktop command surface is intentionally local and read-only with respect to GitLab. GitLab requests use `GET`, reject credential-bearing base URLs and redirects, require HTTPS except for localhost tests, and authenticate with either `Private-Token` or `Authorization: Bearer` as configured.

## Verification

Focused contracts:

```bash
npm test --workspace=@getpaseo/desktop -- --run src/features/mr-tracker/store.test.ts src/features/mr-tracker/gitlab-client.test.ts src/features/mr-tracker/service.test.ts
npm test --workspace=@getpaseo/app -- --run src/mr-tracker/model.test.ts src/mr-tracker/importance-control.test.tsx src/components/ui/tooltip.test.tsx
```
