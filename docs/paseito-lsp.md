# Paseito editor LSP

Paseito's source-file editor can attach to the language server already owned by Lens. The first
supported languages are C/C++ and Python. The initial surface provides diagnostics, automatic and
manual completion, hover, go-to-definition, and optional format-on-save.

## Ownership and transport

Lens remains the only owner of the language-server process. Its extension publishes the existing
in-process LSP service through a versioned NDJSON Unix socket (or Windows named pipe) with a stable
endpoint derived from the workspace. Paseito's daemon is only a transport bridge:

```text
CodeMirror editor -> Paseito WebSocket RPC -> Paseito daemon -> Lens broker -> Lens LSPService
```

Paseito never starts a Lens service. If Lens is not active for the workspace, only editor LSP is
marked unavailable; editing and saving continue normally. This attach-only rule prevents a second
clangd or Python server from appearing when Lens starts after Paseito.

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
editor or affecting file editing. The daemon advertises `features.workspaceLsp`; older daemons do
not expose the controls.

## Compatibility boundary

The Paseito protocol uses the dotted `workspace.lsp.request` and `workspace.lsp.response` RPCs. Each
request carries the editor document version, and the client rejects a response for a different
version. Lens's local broker protocol is separately versioned; either side must fail closed on an
unsupported version rather than guessing at a payload shape.
