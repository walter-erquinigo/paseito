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
`features.workspaceLsp`; older daemons do not expose the controls.

Hover and definition requests allow 15 seconds for large C++ workspaces that are still building a
background index. A timeout returns no result for that interaction but does not permanently disable
an otherwise healthy editor session; later requests can succeed as clangd warms up.

## Compatibility boundary

The Paseito protocol uses the dotted `workspace.lsp.request` and `workspace.lsp.response` RPCs. Each
request carries the editor document version, and the client rejects a response for a different
version. Lens's local broker protocol is separately versioned; either side must fail closed on an
unsupported version rather than guessing at a payload shape.
