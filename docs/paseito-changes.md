# Paseito Changes extensions

Paseito adds four capability-gated review features to the Changes view.

## Comparison and branch ordering

The base selector changes only the read-only comparison used by Changes, commit history, and review
attachments. It does not change merge, pull-request, or update targets. Branch switcher results put
branches on the current first-parent stack first, ordered from the configured base toward the
current tip. Other `werquinigo/` branches follow, then remaining branches by recency.

When the current branch has commits ahead of its base, Changes opens on the committed branch diff
even if the working tree is dirty. The **Uncommitted** option remains available and an explicit
selection is honored for as long as the checkout's dirty state does not change.

## Hidden context

Omitted regions between diff hunks can load 20 lines from either edge or request the whole remaining
region. Full expansion is paginated at 5,000 lines and 1 MiB per daemon response. The request names
the expected current-file revision; a changed file rejects the request instead of mixing revisions.
Expansion is session-local, while persisted comments and suggestions automatically reveal their
target region when the Changes view reopens.

## Suggested edits

Starting a comment on a current-side added or context line exposes **Suggest edit**. On macOS, drag
across current-side line-number gutters or Shift-click two endpoints to select a contiguous range.
The selected lines can cross manually expanded context and synthetic hunk boundaries, but every line
must be loaded first. Omitted lines must be expanded before completing the selection. Escape or a
click outside the diff cancels an unfinished Shift-click selection.

Completing a range opens the editor below its final line with a copy of the original source ready to
edit. A suggestion can contain up to 200 lines and includes replacement text plus an optional note.
An empty replacement means deletion. Suggestions are persisted with their original source and file
revision and are included in the review attachment sent to the destination agent. They never edit
the checkout or post to GitHub/GitLab.

New inline review drafts use explicit **Comment** and **Code change** tabs. Comment mode shows only
the message field and submits any non-empty comment. Code change mode shows the selected source plus
an optional explanation; its submission remains disabled until the replacement differs from the
source. Switching tabs preserves both the message and the in-progress replacement.

Sent **Review** attachments stay compact by default. Clicking the attachment header expands it in
place into a scroll-bounded list of the submitted comments and code changes, including each file and
line location. Comment text remains selectable, and clicking the header again collapses the list.
The collapsed count includes both ordinary comments and code changes.

When the file revision changes, the suggestion remains visible as stale. Sending is blocked until
the reviewer edits it against the current lines or deletes it; Paseito never silently remaps it.
Older daemons continue to support ordinary diffs and comments but do not expose context expansion or
suggestions.

## Reviewed files

Each file header can be marked reviewed. The private local record is scoped by host, main repository,
branch, and exact file path, while the daemon-provided content revision determines whether the check
is still valid. Amending or rebasing a branch therefore preserves checks for identical branch-side
content regardless of the selected comparison base or diff mode.

Marking a file reviewed collapses it, and marking that file unreviewed expands it. If its content
revision changes, Paseito clears the visible check and reopens the file once; returning to the
reviewed content restores the check. The toolbar shows reviewed progress and can mark and collapse,
or clear without expanding, every file in the current diff. A separate toolbar action expands every
file that is not fully reviewed and collapses every completed file; in tree view it also opens the
ancestor folders needed to reveal those incomplete files. The same records are used by Committed and
Uncommitted views, but are not committed, synchronized, sent to an agent, or posted to a forge. Older
daemons expose an update-host message instead of attempting to infer content identity from patch
text.

Text diffs also expose an always-visible checkbox in a fixed 22px gutter slot for every physical
added and removed line. Every row reserves the slot, but context and hunk rows leave it blank. A
replacement therefore has one review item on each side, while context lines are never counted. File review is derived from
the visible edited lines: checking a file checks them all, clearing it clears them all, and completing
the final line collapses the file. Binary and oversized diffs remain explicitly reviewable only at
file level.

Clicking an edited line selects it for keyboard review. `M` moves down and `,` moves up, approving
the current line and selecting the next unchecked line in that direction while expanding the
destination file and folder as needed. The selected line carries a small accent marker in the fixed
review gutter. Keyboard navigation leaves an already-visible destination in place and centers a
destination that is outside the diff viewport.
`Space` toggles without moving, `U` undoes the latest keyboard approval, `Escape` clears selection,
and `E` opens the nearest current-file line in a side-by-side built-in editor. Entirely deleted files
cannot be opened for editing.

Line records use exact content, side, change type, and surrounding context. Unique unchanged edits
survive a new file revision; changed or ambiguous duplicate edits are cleared. Existing file-level
records are materialized as reviewed lines the first time the upgraded client observes that diff.

## Full-tab file navigator

The desktop Changes tab has a fixed 240px file navigator on the right. It reuses the Changes
directory hierarchy, compresses single-child folder chains, and shows file status plus addition and
deletion counts. Folder expansion belongs to the retained Changes tab, while the whole navigator's
collapsed preference persists across tabs and app launches. A pane narrower than 800px suppresses
the navigator without changing that preference, so it returns automatically when the pane widens.

Selecting a navigator file expands its diff, aligns the virtualized file header with the top of the
diff viewport, and focuses the diff surface. Repeated selections issue new focus requests. Manual
diff scrolling does not change selection, and a selection is cleared only when that path disappears
from the active comparison. Commit diffs, the inline Changes panel, and compact layouts do not render
the navigator.

Editor LSP now prefers the existing Lens broker but no longer depends on Lens for C and C++ files.
When Lens is absent, the daemon starts one shared clangd for the workspace and automatically uses a
compilation database from either the workspace root or its `build` directory. Hovering a token shows
clangd information, while `F12`, Command/Ctrl-click, and the Electron **Go to Definition /
Declaration** context-menu action open the source definition in Paseito.

## Markdown preview source links

Markdown file previews recognize source locations in ordinary prose and inline code. Relative paths
resolve from the active workspace, absolute paths can point to any readable local file, and explicit
Markdown links continue to support paths containing spaces. Auto-detected paths are
whitespace-delimited and require a location suffix; fenced code blocks and plain filenames remain
untouched, while web URLs continue to open externally.

Preview locations accept `path:10-14`, `path#L10-L14`, and `path lines 10-14` as explicit line
ranges. A column is always the final colon-delimited number: `path:10:4` means line 10, column 4,
while `path:10-14:4` adds column 4 to the range. `path(10,4)` and `path#L10C4` remain supported.

On desktop, clicking a preview source location first checks for an already-open full **Changes** tab.
When that tab's active working comparison contains the workspace-relative file and can render the
requested current-side line, Paseito focuses the existing tab, expands the file, loads omitted
context when supported, and highlights the requested line or range. Unwrapped diffs also reveal the
requested column horizontally. When no full Changes tab is open, the same navigation reuses a
visible inline **Changes** explorer, focusing its review surface without opening a file tab. Binary,
oversized, deleted-only, invalid, unsupported hidden-context, outside-workspace, unchanged, or
otherwise unavailable targets instead open source mode in the pane immediately to the left, reusing
it when present or creating a left split when necessary. A closed Changes surface is never created
by a preview link.

The Markdown preview stays visible when source mode is used, and links never create or target a pane
on its right. The editor focuses and centers the requested 1-based location, clamping positions beyond
the document or line end. Compact layouts retain this source-opening behavior. A missing target leaves
the preview intact and shows the existing file-not-found notification. Commit diffs and inline
Changes panels that are not currently visible are not Markdown navigation targets.
