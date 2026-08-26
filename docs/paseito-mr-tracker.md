# Paseito MR tracker

The MR tracker is a desktop-client feature for monitoring GitLab merge requests. It does not add a daemon capability and does not run on remote Paseito hosts. The renderer handles a token only while the user types and submits it; desktop-main persistence never returns the stored token to renderer state.

## Surface

Electron builds show an **MRs** section above **Workspaces** with **All**, **My MRs**, and **Others** views. The section gear opens **Settings → MRs**. The views are read-only: they can open an MR in GitLab, add or remove a local tracked-MR record, and set local importance, but they never mutate GitLab.

Each refresh discovers open MRs authored by the configured user and additional exact usernames, optionally includes MRs where the configured user is a reviewer, and includes manually tracked MRs. Results are grouped into per-project stacks by matching a child MR's target branch to another MR's source branch. A filtered tab retains out-of-tab ancestors as stack context. Local triage is binary: **Important** or **Ignore**. The toolbar can show only Important MRs; legacy Later and Ignore values both load as Ignore.

Settings can select GitLab accounts whose activity is tracked on MRs authored by the configured owner. Their badges appear in **My MRs** and on the same owned rows in **All**, never on non-owned reviewer or manually tracked MRs. Account identity uses the GitLab user ID because service accounts can share display names. A non-system note establishes activity even when GitLab does not make it resolvable; unresolved state comes only from authored resolvable notes.

The local Chrome extension in `packages/chrome-extension` adds a right-edge **Open in Paseito** tab to merge-request pages on explicitly enabled GitLab origins. The extension recognizes the page URL without making a GitLab API request. Opening the tab uses `paseito://mrs/open?url=...`; desktop main validates the URL against the configured GitLab server, locally tracks a missing open MR, selects **My MRs** or **Others** from the resolved owner, expands the row, centers it, and briefly highlights it. Repeated links carry a focus revision so an already-open row receives the same treatment again.

The fixed refresh cadence is two minutes. The first successful refresh establishes a silent notification baseline. Later complete refreshes can notify for a newly discovered owned MR, an MR becoming ready, or a new failed pipeline. Partial refreshes preserve cached data and do not advance notification transitions.

Readiness uses generic GitLab facts only: open non-draft state, mergeable status, successful latest overall GitLab pipeline, required approvals satisfied, no merge conflict, and resolved blocking discussions. Product-specific CI, Jira, trusted-bot, and automation rules from the former MR Tracker application are deliberately excluded.

## Credentials and persistence

Settings store the GitLab base URL, username, additional usernames, selected activity-account identities, reviewer preference, and authentication-header type in `mr-tracker.json` under Electron's stable Paseito `userData` directory. After submission, the access token is never written to that JSON file, returned over desktop IPC, logged, or included in an error.

The token is stored separately as `mr-tracker-token` with owner-only mode `0600` in Paseito's local application-data directory. Paseito deliberately does not use macOS Keychain. This keeps credentials out of the public repository and other user accounts, but it does not encrypt the token against software running as the same macOS user. Removing the token in settings deletes this file.

The desktop command surface is intentionally local and read-only with respect to GitLab. GitLab requests use `GET`, reject credential-bearing base URLs and redirects, require HTTPS except for localhost tests, and authenticate with either `Private-Token` or `Authorization: Bearer` as configured.

The Chrome extension has no access to the tracker token. It requests page access one HTTPS origin at a time from its popup and stores only the enabled origins in Chrome local extension storage.

## Local Chrome installation

Build the unpacked extension, then load its generated directory in Chrome:

```bash
npm run build --workspace=@getpaseo/chrome-extension
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `packages/chrome-extension/dist`. On a GitLab MR page, open the extension popup and enable that host. Chrome may ask once before launching the `paseito://` application link.

## Verification

Focused contracts:

```bash
npm test --workspace=@getpaseo/desktop -- --run src/features/mr-tracker/store.test.ts src/features/mr-tracker/gitlab-client.test.ts src/features/mr-tracker/service.test.ts
npm test --workspace=@getpaseo/app -- --run src/mr-tracker/model.test.ts src/mr-tracker/activity-state.test.ts src/mr-tracker/settings-form-model.test.ts src/mr-tracker/importance-control.test.tsx src/components/ui/tooltip.test.tsx
npx vitest run packages/protocol/src/mr-deep-link.test.ts packages/desktop/src/mr-navigation.test.ts --bail=1
npm test --workspace=@getpaseo/chrome-extension
npm run test:e2e:renderer --workspace=@getpaseo/desktop -- e2e/mr-tracker-row.spec.ts
```
