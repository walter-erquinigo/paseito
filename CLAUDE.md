# CLAUDE.md

Paseo is a mobile app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket. Connects directly to your actual development environment — your code stays on your machine.

**Supported agents:** Claude Code, Codex, GitHub Copilot, OpenCode, and Pi.

## Repository map

This is an npm workspace monorepo:

- `packages/server` — Daemon: agent lifecycle, WebSocket API, MCP server
- `packages/app` — Mobile + web client (Expo)
- `packages/cli` — Docker-style CLI (`paseo run/ls/logs/wait`)
- `packages/relay` — E2E encrypted relay for remote access
- `packages/desktop` — Electron desktop wrapper
- `packages/website` — Marketing site (paseo.sh)

## Docs

`docs/` is the source of truth for system-level and process-level knowledge. **"The docs", "check the docs", or "check the X docs" always mean this directory — not the web.** Look here before fetching anything online; the docs capture gotchas and conventions you cannot derive from the code or external sources.

At the start of non-trivial work, list `docs/` and skim anything relevant to the task.

| Doc                                                                | What's in it                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [docs/product.md](docs/product.md)                                 | What Paseo is, who it's for, where it's going                                                                                  |
| [docs/architecture.md](docs/architecture.md)                       | System design, package layering, WebSocket protocol, agent lifecycle, data flow                                                |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)                 | Agent states, parent/child relationships, archive semantics, tabs vs archive, subagents track                                  |
| [docs/data-model.md](docs/data-model.md)                           | File-based JSON persistence, Zod schemas, atomic writes, no migrations                                                         |
| [docs/glossary.md](docs/glossary.md)                               | Authoritative terminology — UI label wins, no synonyms                                                                         |
| [docs/coding-standards.md](docs/coding-standards.md)               | Type hygiene, error handling, state design, React patterns, file organization                                                  |
| [docs/design.md](docs/design.md)                                   | Design system — tokens, buttons, hierarchy, density, alignment rails, states, what's forbidden                                 |
| [docs/forms.md](docs/forms.md)                                     | Form architecture — non-React form model, form kit, load-state gating; the schedule form is the golden example                 |
| [docs/hover.md](docs/hover.md)                                     | Hover — the canonical pattern (plain View + onPointerEnter/Leave, separate inner Pressable) and the three ways agents break it |
| [docs/unistyles.md](docs/unistyles.md)                             | Unistyles gotchas — `useUnistyles()` is forbidden, alternatives in order                                                       |
| [docs/floating-panels.md](docs/floating-panels.md)                 | Anchored popovers — Portal/Modal escape for Android, lifecycle gates, keyboard-shared-value, status-bar offset, the flash      |
| [docs/menus.md](docs/menus.md)                                     | The menu engine — popover vs sheet, submenu pages, hover intent, when a decision earns a submenu                               |
| [docs/expo-router.md](docs/expo-router.md)                         | Expo Router route ownership, startup restore, and native blank-screen gotchas                                                  |
| [docs/file-icons.md](docs/file-icons.md)                           | Material icon theme integration for the file explorer                                                                          |
| [docs/providers.md](docs/providers.md)                             | Adding a new agent provider end-to-end                                                                                         |
| [docs/forge-providers.md](docs/forge-providers.md)                 | Adding a git forge: registry/manifest, drop-in checklist, self-host/GHES, the two facts tiers                                  |
| [docs/custom-providers.md](docs/custom-providers.md)               | Custom provider config: Z.AI, Alibaba/Qwen, ACP agents, profiles, custom binaries                                              |
| [docs/plugins.md](docs/plugins.md)                                 | Local plugin manifest, directory source config, RPCs, native surfaces, and attachment sources                                  |
| [docs/service-proxy.md](docs/service-proxy.md)                     | Service proxy: exposing workspace scripts at public URLs, DNS setup, reverse proxy config                                      |
| [docs/development.md](docs/development.md)                         | Dev server, build sync gotchas, CLI reference, agent state, Playwright MCP                                                     |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)                 | WebSocket RPC naming convention — dotted namespaces and `.request`/`.response` pairs                                           |
| [docs/protocol-compatibility.md](docs/protocol-compatibility.md)   | Why app/daemon versions drift, protocol vs feature contract, capability gating, COMPAT tagging                                 |
| [docs/protocol-validation.md](docs/protocol-validation.md)         | zod-aot generated inbound WebSocket validation, patched compiler regressions, schema-purity rules                              |
| [docs/terminal-performance.md](docs/terminal-performance.md)       | Terminal latency pipeline, coalescing/backpressure invariants, benchmark + perf spec usage                                     |
| [docs/file-observation.md](docs/file-observation.md)               | Recursive watcher ownership, Linux constraints, teardown invariants, and Parcel comparison                                     |
| [docs/testing.md](docs/testing.md)                                 | TDD workflow, determinism, real dependencies over mocks, test organization                                                     |
| [docs/qa.md](docs/qa.md)                                           | QA evidence bar for pull requests — platform matrix, version drift, performance, UI proof                                      |
| [docs/mobile-testing.md](docs/mobile-testing.md)                   | Maestro and mobile test workflows                                                                                              |
| [docs/mobile-panels.md](docs/mobile-panels.md)                     | Compact left/center/right panel ownership, worklet motion, gesture revisions, and Fabric constraints                           |
| [docs/explorer-sidebar.md](docs/explorer-sidebar.md)               | Explorer sidebar and ordinary side-pane host contracts, lifecycle, placement, and routing preferences                          |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md)     | Isolated in-process daemon test harness                                                                                        |
| [docs/browser-capture-harness.md](docs/browser-capture-harness.md) | Real-Electron browser screenshot harness and compositor-surface gotcha                                                         |
| [docs/android.md](docs/android.md)                                 | App variants, local/cloud builds, EAS workflows                                                                                |
| [docs/docker.md](docs/docker.md)                                   | Running the daemon and bundled web UI in Docker, volumes, agent images, security                                               |
| [docs/release.md](docs/release.md)                                 | Release playbook, draft releases, completion checklist                                                                         |
| [docs/terminal-activity.md](docs/terminal-activity.md)             | Terminal activity indicators — source-agnostic tracker, agent hook reporting, adding a new hook provider                       |
| [docs/paseito-mr-tracker.md](docs/paseito-mr-tracker.md)           | Desktop GitLab MR tracking, stack semantics, notification baseline, and owner-only credential persistence                      |
| [SECURITY.md](SECURITY.md)                                         | Relay threat model, E2E encryption, DNS rebinding, agent auth                                                                  |
| [public-docs/hub/security.md](public-docs/hub/security.md)         | Public Hub guide — trust boundaries, untrusted triggers, provider controls, and output authority                               |

### Writing docs

- **Integrate, don't append.** Find the doc that owns the subject and rewrite the part that is now wrong. The standard failure is finishing a task and adding a paragraph to the bottom of the closest-looking doc; ten tasks later the doc is a pile of paragraphs in discovery order. `docs/custom-providers.md` is what that looks like.
- **Don't document logic.** Prose that restates code drifts from the code and loses. Write down what the code can't tell you: why something is shaped the way it is, the gotcha that cost an afternoon, conventions nothing enforces, constraints that span packages or versions. If a reader could get it in two minutes by opening the file, cut it.
- **One fact, one doc.** Every other mention is a link. If you are about to write the same paragraph in two docs, one of them is a link.
- **Respect the layers.** `CONTRIBUTING.md` and this file name things and link out. Activity docs like `docs/qa.md` and `docs/testing.md` set the bar for a kind of work. Subject docs like `docs/unistyles.md` own one thing completely. A layer never re-explains the one below it.
- **One subject per doc.** If the subject doesn't fit in a sentence, split the doc. A section per provider, vendor, or platform is a table plus one worked example.
- **Delete.** Obsolete sections go. Prefer a `packages/app/src/thing.ts:120` reference over a pasted block.
- **New doc?** Add a row to the table above and link it from the docs that should send readers there.
- Code-level facts belong in comments next to the code, not here.

### Doc voice

Plain and short. Second person. State the rule, then the reason when the reason isn't obvious. Match the doc you're editing.

Do not:

- Write a sentence to land a point. "It's not X, it's Y", "That's not a Z, that's a W", and every other setup-and-punchline shape.
- Add a clause that only asserts importance: "and that matters", "which is what keeps it working", "this is critical".
- Use "honest", "robust", "seamless", "powerful", "simply", "just", "delightful".
- Restate something you already said, in different words, for emphasis.
- Hedge with "generally", "typically", or "you may want to" when the answer is "do this".
- Clear your throat: "It's worth noting that", "In order to", "This section covers".

## Quick start

```bash
npm run dev                          # Start the dev daemon
npm run dev:app                      # Start Expo against the dev daemon
npm run dev:desktop                  # Start Electron desktop dev
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Always run after changes
npm run lint                         # Always run after changes
npm run format                       # Auto-format with Biome
npm run format:check                 # Check formatting without writing
```

Repo dev commands use checkout-local state by default. In this checkout, `PASEO_HOME` resolves to `.dev/paseo-home`, and `npm run cli -- ...` targets that same dev home automatically. The packaged desktop app and production-style daemon keep using `~/.paseo` on port `6767`.

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Critical rules

- **NEVER restart the main Paseo daemon on port 6767 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **Before changing app routes, startup routing, remembered workspace restore, or active workspace selection, read [docs/expo-router.md](docs/expo-router.md).**
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - Run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Always run typecheck and lint after every change.**
- **Build workspace packages before diagnosing cross-package type errors.** This repo consumes generated declarations across workspaces. If typecheck fails in a package that depends on another workspace, rebuild the owning stack first so `dist` declarations are current:
  - `npm run build:client` — rebuild protocol and client declarations.
  - `npm run build:server` — rebuild highlight, relay, protocol, client, server, and CLI when server/CLI types may be stale.
  - Do not patch inferred callback parameters or add local duplicate types just to silence stale declaration errors.
- **Run `npm run format` before committing.** This repo uses Biome for formatting. Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **The protocol stays backward-compatible. Features don't have to.** Read [docs/protocol-compatibility.md](docs/protocol-compatibility.md) before touching `packages/protocol`. The short version:
  - **Protocol contract (always):** an old client parses messages from a new daemon, and a new daemon parses messages from an old client. New fields are optional; never narrow, never remove, never require. Wire schemas stay pure — no `.transform()`, `.catch()`, or `.preprocess()`.
  - **Feature contract (per-feature):** gate the capability once on `server_info.features.*`, then run the feature or tell the user to update the host. No fallback paths, no defensive branches.
  - **Every shim is tagged.** `// COMPAT(name): added in vX, remove after <date>` at the site that has to be deleted. `rg "COMPAT\("` is the cleanup backlog; untagged back-compat is permanent by accident.
  - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.

## GUI critique and repair prompts

For GUI creation, repair, or refinement, use the prompts below as working instructions. Read
[docs/design.md](docs/design.md) and [docs/qa.md](docs/qa.md) first. Review the actual rendered
state at the target platform and viewport; source code intent is not visual evidence. These prompts
adapt the observable **Before / After / Why** review structure from
[Humbleteam's design-review](https://github.com/humbleteam/design-review), the screenshot-driven
repair loop from [PixelJury](https://github.com/gchahal1982/pixeljury), and the combined designer and
frontend-engineer role from
[vltansky's design-review skill](https://github.com/vltansky/skills/blob/master/skills/design-review/SKILL.md).

### Screenshot diagnosis prompt

```text
Act as a senior product designer and frontend engineer reviewing the actual rendered screenshot,
not the implementation's intended appearance. Read the product design system first and identify
the exact platform, viewport, theme, UI state, and running build version shown.

Report at most five prioritized issues. For each issue:
- Before: state one observable defect and name the affected bounds, alignment rails, gutters,
  controls, or content.
- After: prescribe one measurable change to position, spacing, sizing, overflow, hierarchy,
  typography, or interaction state.
- Why: connect the change to a project design rule or one named usability/accessibility principle.

Prioritize clipped content, overlap, stale geometry, broken rendering, and inaccessible controls
before aesthetic polish. Distinguish facts visible in the screenshot from implementation
hypotheses. Check whether a stale installed bundle could explain the screenshot before changing
source code. Do not use vague judgments such as "cleaner", "modern", or "better spacing" without
pixel-level evidence.
```

### Implementation and verification prompt

```text
Implement the prioritized GUI corrections in the repository. Trace each visible defect through
layout, cached geometry, asynchronous state, content parsing, and component styling to find its
root cause. Preserve working behavior, accessibility, responsive states, and existing design
tokens. Do not mask a model or state defect with arbitrary padding, fixed offsets, or overflow.

Add focused regression coverage for every state or geometry transition that caused the defect.
Render the same target state and viewport after the change, then compare the before and after
screenshots using observable bounds. Reject the result if content, source rows, gutters, controls,
or hit targets overlap; if reserved space does not match rendered content; if raw markup leaks into
the UI; or if another supported viewport regresses. Verify the version and executable path of the
app that produced the final screenshot before declaring the GUI fix complete.
```

## Platform gating

The app runs on iOS, Android, web (browser), and web (Electron desktop). Code is cross-platform by default. Gate only when you must. Import gates from `@/constants/platform`.

### The four gates

| Gate                       | Type      | When to use                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. This is the **exception**, not the default. |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                              |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.                 |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split. From `@/constants/layout`.       |

### Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always-visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

### Rules

- **Default is cross-platform.** Don't gate unless you have a specific reason.
- **Prefer Metro file extensions over `if` statements.** When a module has fundamentally different implementations per platform, use `.web.ts` / `.native.ts` file extensions instead of runtime `if (isWeb)` branches. Metro resolves the correct file at build time — the unused platform code is never bundled. Reserve `if (isWeb)` for small, inline checks (a single line or a few props). If you find yourself writing a large `if (isWeb) { ... } else { ... }` block, split into separate files instead.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.
- **Use `.electron.ts` / `.electron.tsx` for Electron-only web modules.** Electron is still the Metro `web` platform, but desktop dev/build sets `PASEO_WEB_PLATFORM=electron`, so Metro first looks for `.electron.*` files and falls back to normal `.web.*` files. Use this when the implementation depends on Electron-only behavior such as `webviewTag`, desktop preload APIs, or the Electron bridge. Keep plain browser web in `.web.*`, and keep native fallbacks in the base file or `.native.*`.
  ```
  desktop/browser/pane/
    index.electron.tsx ← Electron <webview> implementation
    index.web.tsx      ← plain web fallback
    index.tsx          ← native fallback
  ```
  Import as `@/desktop/browser/pane` — Electron desktop gets the `.electron.tsx` file, browser web gets `.web.tsx`, and native gets the native/base implementation.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **NEVER use `onPointerEnter`/`onPointerLeave`.** They don't fire on native iOS.
- **Hover only works on web.** React Native's `onHoverIn`/`onHoverOut` on `Pressable` does NOT fire on native iOS/iPad — the underlying W3C pointer events are behind disabled experimental flags. For hover-to-show UI (kebab menus, action buttons), use `isHovered || isNative || isCompact` so the controls are always visible on native and hover-to-show on web.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $PASEO_HOME/daemon.log

## Verify the build the user is actually running

Source changes are not visible in an already-running packaged Paseito app. Before reporting a desktop UI change as complete or diagnosing a missing UI element:

0. Every commit that changes Paseito must increment the numeric `paseito.N` prerelease identifier in the root and desktop package versions. Never publish two different Paseito commits with the same visible version.
1. Identify the exact version and path of the running app and daemon. On macOS, inspect the process path and the app's `Info.plist`; do not infer the running version from `package.json`.
2. Compare that version with the version or commit that introduced the feature. Treat a stale running bundle as the first suspect when source-level tests pass but the UI is absent.
3. For desktop UI work, run `npm run build:desktop` and verify the produced app's embedded `CFBundleShortVersionString` before claiming that a packaged build contains the change.
4. Validate the new bundle in an isolated development profile and on non-production ports when possible. A source checkout, passing unit tests, or an Expo export alone is not proof that the user's packaged app has been updated.
5. State the relaunch/install requirement explicitly in the handoff. Do not imply that an existing Electron process hot-reloads a newly built bundle.
6. Never replace, quit, or relaunch the packaged app—and never restart its daemon on port `6767`—without the user's permission. Building an artifact is allowed; activating it is a separate step.
7. When an improvement results in a new local Paseito installation, do not report it complete until the installed build is verified, the complete improvement is committed, and the commit is pushed to `fork/paseito`. A recovery tag is not a substitute for the branch push. If unrelated or mixed worktree changes prevent a coherent commit, separate them before installing; if that cannot be done safely, stop and report the blocker.

For capability-gated UI, verify both sides of the runtime contract: the client bundle must contain the feature and the connected daemon must advertise the required `server_info.features.*` capability. When the capability is absent, the UI must show an explicit upgrade message rather than silently hiding the feature.

See [docs/development.md](docs/development.md) for isolated runtime ports and [docs/release.md](docs/release.md) for packaging and release checks.

<!-- PASEITO-LOCAL-FEATURES:START -->

## Paseito local feature preservation

`automation/feature-registry.json` is authoritative. Before and after every upstream rebase,
verify each feature and its preservation fixes; update the registry and regenerate this block
instead of editing the list by hand.

- `independent-desktop-identity` — Keep Paseito independently installable beside Paseo with distinct app, daemon, CLI, storage, protocol and visual identities.
  - Fix: Keep the desktop bundle, daemon, CLI, storage, URL scheme, updater and artwork independent from Paseo.
- `changes-base-selector` — Let the Changes tab select and remember a read-only comparison base without changing merge, update or pull-request targets.
  - Fix: Default ahead branches to their committed branch diff without hiding the explicit Uncommitted view.
  - Fix: Use valid top-commit Stack-Parent branches as the default comparison base and keep invalid markers visible.
  - Fix: Sort every werquinigo/ branch first in literal name order on both current and legacy hosts.
  - Fix: Keep branch search focused while revealing and activating the selected branch, including when it is absent from the bounded suggestion response.
- `changes-uncommitted-branch-badge` — Show the selected branch's uncommitted working-tree state beside the Changes branch switcher.
  - Fix: Keep the branch badge tied to live checkout dirtiness while Changes displays either comparison mode.
- `changes-amend-current-commit` — Amend every current working-tree change into the current commit directly from Changes.
  - Fix: Keep the one-click amend action tied to the live uncommitted badge and daemon capability.
- `changes-context-expansion` — Load and review omitted source context on demand from the Changes diff without transferring entire files by default.
  - Fix: Keep context expansion bounded, revision-validated and available to comments and suggestions.
  - Fix: Keep omitted context visually integrated with the diff while retaining adaptive edge and whole-region controls.
- `review-suggestions-v1` — Let a reviewer send persisted, structured one- or multi-line replacement suggestions to the destination agent from Changes.
  - Fix: Keep multi-line comment editors focused without viewport jumps.
  - Fix: Keep comment threads aligned with fixed diff-gutter rows.
  - Fix: Keep local review comments and suggestions aligned after the diff gutter without changing their reserved interstitial geometry.
  - Fix: Keep review attachment contracts intact after upstream reconciliation.
- `branch-file-review-state` — Let reviewers mark branch files or individual edited lines reviewed while preserving checks only for identical branch-side content.
  - Fix: Expand a file when it is marked unreviewed.
  - Fix: Require the review-state capability in packaged and remote releases.
  - Fix: Preserve repeated reviewed edits only when their uniquely anchored sequence mapping is unambiguous.
  - Fix: Show the live Changes-focus binding in the selected-line shortcut widget.
  - Fix: Keep per-line review state scannable with persistent hollow and filled dots in a fixed slot that never overlaps line numbers.
  - Fix: Restore the selected-line E action through every file-opening host so it opens and focuses the mapped current-side source line.
  - Fix: Keep bulk review operations visible in a dedicated progress menu and reserve file-header space for its per-file review control.
- `changes-gitlab-discussions` — Show the current branch's GitLab MR discussions inline in Changes and in an adaptive inbox, with confirmed replies.
  - Fix: Keep GitLab discussion placement revision-aware and visibly mark every best-effort anchor.
  - Fix: Keep replies daemon-owned, confirmation-backed and capability-gated on every remote host.
  - Fix: Keep inline GitLab threads in blank interstitial diff rows with a gutter-edge control that collapses presentation without mutating forge resolution, and invalidate cached row geometry whenever those states change.
  - Fix: Render GitLab discussion bodies through the shared Markdown and HTML-aware renderer instead of exposing source markup.
- `changes-source-navigation` — Search complete current-side changed files and use shared language intelligence directly from Changes.
  - Fix: Share revision-safe LSP sessions with the editor and suppress stale buffers.
  - Fix: Anchor LSP positions to current-side source text and pause Changes intelligence while the workspace is dirty.
  - Fix: Preserve the exact terminal-newline form when rebuilding paged source for shared LSP sessions.
  - Fix: Keep each file's responsive LSP status inside the file-header action rail so it cannot overlap diff statistics or context rows.
  - Fix: Render structured LSP hover Markdown through the shared editor renderer and keep the hover inside the diff viewport.
  - Fix: Search complete changed-file source on the daemon without transferring every file before results.
- `lens-shared-editor-lsp` — Provide editor intelligence through the existing Lens language server when available and a daemon-owned clangd fallback for ordinary C/C++ workspaces.
  - Fix: Keep cold-index deadlines, document-version rejection and safe save fallback behavior.
  - Fix: Replay pooled LSP state to late editor leases and keep backend failures visible with retry.
- `markdown-preview-source-links` — Open source locations from a Markdown file preview in an existing review surface or a reusable split pane without replacing the preview.
  - Fix: Route source links to a visible Changes pane before creating an editor split.
- `local-semantic-maintenance` — Use human-supervised weekly Codex reconciliation, fail-closed verification, provenance-bound installation, migration and daily reporting.
  - Fix: Normalize local history into one commit per feature before inspecting or rebasing onto upstream.
  - Fix: Keep Git metadata controller-owned and independent semantic review read-only.
  - Fix: Verify deferred browser contracts, release provenance, installers and remote-daemon rollback before promotion.
  - Fix: Keep weekly overlap decisions interactive and scheduled publication credentials local.
  - Fix: Open weekly work in iTerm2 and finish locally when GitHub Actions quota is exhausted.
  - Fix: Bind every remote daemon to immutable GitHub release evidence and block cutover on runtime or service-unit drift without explicit restart approval.
  - Fix: Keep optional remote deployment arguments defined under nounset so routine schema-v3 cutovers do not require legacy exceptions.
  - Fix: Open scheduled iTerm sessions without launchd-owned AppleEvents and retain pushed revisions until published provenance catches up.
  - Fix: Reject post-reconciliation candidates whose rebased history is not normalized before independent review or promotion.
- `agent-message-delivery-control` — Let users queue durable follow-up messages or explicitly steer an active agent run without conflating the two actions.
  - Fix: Restore failed sends to their original queue position and preserve legacy replacement behavior.
- `workspace-file-search-navigation` — Find every eligible workspace file from Command+P and open it either as source or in Changes.
  - Fix: Keep exhaustive project-file search fast and preserve alternate navigation into the active Changes comparison.
  - Fix: Gate exhaustive search on daemon support, bypass redundant ignored-path enumeration, and reject truncated Git file corpora.
  - Fix: Route Command+Enter to the right Changes sidebar even when a full Changes tab exists.
  - Fix: Keep absolute host-path autocomplete outside the Git index and preserve editable absolute file tabs.
- `desktop-gitlab-mr-tracker` — Track GitLab merge requests and run user-configured, plugin-extensible workflows from Paseito without embedding personal or organization policy.
  - Fix: Keep GitLab access tokens outside renderer-visible state and the repository, stored locally with owner-only permissions without Keychain, and preserve credentials across ordinary desktop upgrades.
  - Fix: Keep the unconfigured tracker free of dead controls and provide direct, security-explained setup actions.
  - Fix: Keep every local triage label understandable through concise desktop hover and keyboard-focus explanations.
  - Fix: Keep MR triage left-anchored while summary navigation, detail expansion, and importance controls remain independent interactions.
  - Fix: Keep MR triage binary as Important or Ignore, normalize legacy local choices to Ignore, and provide an accessible Important-only filter beside search.
  - Fix: Keep always-show GitLab accounts visible before activity while discovering other commenters only after activity, scoped to owner-authored MRs and keyed by stable user identity.
  - Fix: Keep the Chrome bridge token-free and origin-opt-in, expose matching controls even while Paseito is visible, preserve specific bridge errors, and make repeated links reveal, expand, center and highlight the resolved MR.
  - Fix: Keep MR workflow behavior user-configured and plugin-extensible, with no employer, project, username, pipeline, or command policy compiled into Paseito.
  - Fix: Keep automatic mutations transition-triggered, silently baselined, optionally limited to one durable run per MR, durably receipted before dispatch, and fail-closed when data or delivery is uncertain.
  - Fix: Keep desktop MR plugins locally managed from Settings and `paseito plugin --scope desktop`, independent of every registered remote daemon.

<!-- PASEITO-LOCAL-FEATURES:END -->
