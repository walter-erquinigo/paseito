# Paseito MR tracker

The MR tracker is a desktop-client feature for monitoring GitLab merge requests. It does not add a daemon capability and does not run on remote Paseito hosts. The renderer handles a token only while the user types and submits it; desktop-main persistence never returns the stored token to renderer state.

## Surface

Electron builds show an **MRs** section above **Workspaces** with **All**, **My MRs**, and **Others** views. The section gear opens **Settings → MRs**. Ordinary tracking and triage remain local. GitLab mutations occur only from an enabled automation outcome.

**My MRs** has a collapsible 400-pixel rules rail. Narrow windows present the same editor in an adaptive sheet. The editor builds recursive **all**, **any**, and **not** condition trees, previews three-state results against currently loaded owned MRs, and configures automatic outcomes, action buttons, or links. Mutation buttons require confirmation by default. Each matching MR renders its configured buttons and links beneath the normal summary.

```text
┌ My MRs ────────────────────────────────┬ Rules / Activity ────────────┐
│ project / merge-request stacks        │ Rule name              [on] │
│                                       │ WHEN                       │
│  !42 Fix a race                       │  ALL                        │
│  [configured action] [configured link]│   ├ predicate + fields      │
│                                       │   └ NOT predicate           │
│                                       │ THEN                        │
│                                       │  presentation + operation   │
│                                       │  [Preview]       [Save rule]│
└───────────────────────────────────────┴─────────────────────────────┘

Narrow window:
┌ My MRs ────────────────────────────────┐
│ list remains full width                │
└────────────────────────────────────────┘
           ┌ MR automation rules ────────┐
           │ same rule editor in a sheet │
           └─────────────────────────────┘
```

Each refresh discovers open MRs authored by the configured user and additional exact usernames, optionally includes MRs where the configured user is a reviewer, and includes manually tracked MRs. Results are grouped into per-project stacks by matching a child MR's target branch to another MR's source branch. A filtered tab retains out-of-tab ancestors as stack context. Local triage is binary: **Important** or **Ignore**. The toolbar can show only Important MRs; legacy Later and Ignore values both load as Ignore.

Settings can select GitLab accounts whose badges always appear on MRs authored by the configured owner, including a **No activity** state before they comment. Other non-system commenters appear automatically after activity, except for the MR author. Activity badges appear in **My MRs** and on the same owned rows in **All**, never on non-owned reviewer or manually tracked MRs. Account identity uses the GitLab user ID because service accounts can share display names. A non-system note establishes activity even when GitLab does not make it resolvable; unresolved state comes only from authored resolvable notes.

The local Chrome extension in `packages/chrome-extension` adds a right-edge **Open in Paseito** tab to merge-request pages on explicitly enabled GitLab origins. It recognizes the page URL without making a GitLab API request. A packaged macOS build registers an exact-origin Chrome Native Messaging host backed by an owner-only Unix socket. The rail renders matching action buttons and links from the latest tracker refresh whether or not a Paseito window is visible, so both surfaces remain available. A first-time MR can take longer while Paseito tracks it. Every browser mutation is resolved and reevaluated by desktop main immediately before execution. Bridge errors appear in the rail instead of being collapsed into an offline message.

Opening the tab uses `paseito://mrs/open?url=...`; desktop main validates the URL against the configured GitLab server, locally tracks a missing open MR, selects **My MRs** or **Others** from resolved ownership, expands the row, centers it, and briefly highlights it. Repeated links carry a focus revision so an already-open row receives the same treatment again.

The fixed refresh cadence is two minutes. The first successful refresh establishes a silent notification baseline. Later complete refreshes can notify for a newly discovered owned MR, an MR becoming ready, or a new failed pipeline. Partial refreshes preserve cached data and do not advance notification transitions.

Readiness uses generic GitLab facts only: open non-draft state, mergeable status, successful latest overall GitLab pipeline, required approvals satisfied, no merge conflict, and resolved blocking discussions. Automation adds generic predicates for MR state, draft state, title text, approvals, commenter resolution, newly discovered MRs, and exact named pipelines on the current head SHA. Built-in operations post an exact comment, add reviewers without removing existing reviewers, or open the newest exact-name pipeline. Product, employer, project, username, pipeline, and command policy belong in local rule data or a plugin, never source code.

## Automation transitions and receipts

Automation scope is currently **owned MRs**. Predicate evaluation is `match`, `no_match`, or `unknown`; missing contributions and partial GitLab facts fail closed. A newly created or revised rule establishes a silent baseline on the first complete refresh. Automatic outcomes run only after a later complete `no_match` → `match` transition. An automatic outcome can additionally run only once per MR; its durable completion key is written before dispatch and survives receipt trimming and rule revisions. Paseito writes an `attempting` receipt before dispatch. A transport error becomes `uncertain` and is never retried automatically, because the remote mutation may already have succeeded. The Activity tab exposes the durable receipt and error.

Rules and receipts live in owner-only `mr-automations.json` under Electron `userData`. The schema contains only contribution IDs, field configuration, presentations, transition state, and receipts. No private workflow ships in the repository.

## Credentials and persistence

Settings store the GitLab base URL, username, additional usernames, always-show activity-account identities, reviewer preference, and authentication-header type in `mr-tracker.json` under Electron's stable Paseito `userData` directory. After submission, the access token is never written to that JSON file, returned over desktop IPC, logged, or included in an error.

The token is stored separately as `mr-tracker-token` with owner-only mode `0600` in Paseito's local application-data directory. Paseito deliberately does not use macOS Keychain. This keeps credentials out of the public repository and other user accounts, but it does not encrypt the token against software running as the same macOS user. Removing the token in settings deletes this file.

GitLab requests reject credential-bearing base URLs and redirects, require HTTPS except for localhost tests, and authenticate with either `Private-Token` or `Authorization: Bearer` as configured. Reads use `GET`; built-in automation mutations use `POST` for MR notes and `PUT` for the additive reviewer set.

The Chrome extension has no access to the tracker token. It requests page access one HTTPS origin at a time from its popup and stores only the enabled origins in Chrome local extension storage. Native messages contain the normalized MR URL and contribution identifiers, not credentials.

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
npx vitest run packages/desktop/src/features/mr-tracker/automation-store.test.ts packages/desktop/src/features/mr-tracker/automation-engine.test.ts packages/desktop/src/features/mr-tracker/native-messaging-bridge.test.ts packages/server/src/server/plugins/compiler.test.ts packages/cli/src/commands/plugin/index.test.ts packages/cli/src/commands/plugin/scaffold.test.ts --bail=1
npm run test:e2e:renderer --workspace=@getpaseo/desktop -- e2e/mr-tracker-row.spec.ts e2e/desktop-mr-plugins.spec.ts
```
