# Paseito editor LSP

Paseito's source-file editor uses the language server already owned by Lens when one is available.
When Lens is absent, C and C++ workspaces fall back to one daemon-owned clangd process. Python still
requires Lens. The editor surface provides diagnostics, automatic and manual completion, hover,
go-to-definition, and optional format-on-save.

## Ownership and transport

Lens owns the language-server process whenever its extension publishes the existing in-process LSP
service through a versioned NDJSON Unix socket (or Windows named pipe). The endpoint is derived from
the workspace. Paseito's daemon selects that transport when present and owns the clangd fallback
otherwise:

```text
CodeMirror editor -> Paseito WebSocket RPC -> Paseito daemon -> Lens broker -> Lens LSPService
                                                  \-> clangd stdio fallback
```

Paseito never starts a Lens service. It probes the workspace's Lens broker first. If the broker is
absent and the opened document is C or C++, the daemon starts clangd in the workspace, reuses that
process across connected editor sessions, and stops it after the final lease closes. If
`compile_commands.json` exists at the workspace root it is used; otherwise
`build/compile_commands.json` is selected automatically. Other languages remain unavailable when
Lens is absent, while editing and saving continue normally.

The broker restricts paths to its workspace, uses a mode-0600 Unix socket, gives an open document to
one connected client, and rejects non-monotonic document versions. A disconnected client releases
its documents without shutting down Lens's LSP service.

## App behavior

LSP is opt-in per host/workspace and is currently offered only for C/C++ and Python extensions.
Preferences are private app data. Format-on-save is a separate opt-in per workspace and language.
Formatting has a 1.5-second daemon deadline; timeout or any formatting failure writes the unchanged
buffer. Formatting is applied once before the file write and never creates an extra save.

The CodeMirror integration is isolated in one reconfigurable compartment. Turning LSP off removes
the completion, hover, definition, diagnostics, and formatting integration without replacing the
editor or affecting file editing. In Electron, right-clicking a source token adds a native **Go to
Definition / Declaration** action while preserving the ordinary cut, copy, paste, and select-all
actions. `F12` and Command/Ctrl-click use the same definition request. The daemon advertises
`features.workspaceLsp`; daemons with the built-in C/C++ fallback also advertise
`features.workspaceLspClangd`. A host with only the older flag may still depend on Lens, so the menu
tells you to update that host before relying on standalone clangd.

The status follows the shared document session, including when Changes opened the document first.
Startup failures remain visible in the menu with the complete daemon error and a retry action. An
unanswered LSP RPC fails after 30 seconds instead of leaving the editor in a connecting state.

Hover and definition requests allow 15 seconds for large C++ workspaces that are still building a
background index. A timeout returns no result for that interaction but does not permanently disable
an otherwise healthy editor session; later requests can succeed as clangd warms up.

## Compatibility boundary

The Changes view uses the same workspace preference and transport for current-side C/C++ and Python
lines. Hover, F12, Command/Ctrl-click, and the Electron definition context menu are available there.
Each eligible visible file header holds a reference-counted lease and reports the shared session's
connecting, provider, unavailable, and retry state. Virtualized headers release their leases. The
editor and Changes still converge on one app-side document session. When an unsaved editor buffer
differs from the diff revision, Changes reports that file unavailable until the contents agree; it
never replaces the editor's in-memory document. Full-source reads reuse the revision-checked
diff-context transport, so committed comparisons and hidden lines use the exact source represented
by the diff. The reconstruction verifies its terminal-newline form against that revision before it
shares an editor document.

Changes measures navigation columns from the rendered source text. Line-number and review gutters,
deleted-side lines, hunk controls, and other chrome never become LSP targets. Any uncommitted change
in the live workspace pauses all Changes leases and interactions, even while Changes displays the
committed comparison. Cleaning the workspace resumes visible files without changing the saved LSP
preference. Editor LSP remains available while Changes is paused.

The Paseito protocol uses the dotted `workspace.lsp.request` and `workspace.lsp.response` RPCs. Each
request carries the editor document version, and the client rejects a response for a different
version. A successful open identifies `lens` or `clangd`; the field remains optional for older
daemons. Lens's local broker protocol is separately versioned; either side must fail closed on an
unsupported version rather than guessing at a payload shape.
