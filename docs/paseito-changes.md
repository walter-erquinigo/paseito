# Paseito Changes extensions

Paseito adds capability-gated review features to the Changes view.

## Comparison and branch ordering

The base selector changes only the read-only comparison used by Changes, commit history, and review
attachments. It does not change merge, pull-request, or update targets. Branch switcher results put
`werquinigo/` branches first in literal name order. Remaining branches on the current first-parent
stack follow from the configured base toward the current tip, then other branches by recency. When
opened, the branch switcher keeps its search field focused while making the current branch the active
row and scrolling that row into view, even when it falls outside the first 200 suggestions.

When the current branch has commits ahead of its base, Changes opens on the committed branch diff
even if the working tree is dirty. The **Uncommitted** option remains available and an explicit
selection is honored for as long as the checkout's dirty state does not change.

When the top commit contains exactly one `Stack-Parent:` line naming an existing branch, that branch
becomes the default Changes base and opens the committed comparison. A remembered manual base still
wins. A malformed marker or missing branch falls back to the recorded Git base and keeps an error
badge beside the base selector until the top commit is corrected.

## Hidden context

Omitted regions use a quiet separator row instead of code-line chrome. Gaps of up to 40 lines expose
one full reveal. Larger gaps can load 20 lines from either edge or request up to 5,000 lines from the
whole remaining region. The file header retains a compact action for revealing the entire file.
Full expansion is paginated at 5,000 lines and 1 MiB per daemon response. The request names
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
source. Switching tabs preserves the message, in-progress replacement, and selected range. A
multi-line comment stays attached to the full range and renders below its final line.

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
reviewed content restores the check. The toolbar's Review progress menu can mark and collapse every
file, clear every review without changing expansion state, or organize the diff by expanding every
incomplete file and collapsing every completed file. Organizing also opens the ancestor folders
needed to reveal incomplete files in either file tree. The same records are used by Committed and
Uncommitted views, but are not committed, synchronized, sent to an agent, or posted to a forge. Older
daemons expose an update-host message instead of attempting to infer content identity from patch
text.

Text diffs reserve a narrow fixed dot slot before the line number for every physical added and
removed line. A hollow dot is unreviewed and a filled dot is reviewed; both stay visible so review
state can be scanned without hovering. Every row reserves the slot, but context and hunk rows leave
it blank. A replacement
therefore has one review item on each side, while context lines are never counted. File review is derived from
the visible edited lines: checking a file checks them all, clearing it clears them all, and completing
the final line collapses the file. Binary and oversized diffs remain explicitly reviewable only at
file level.

Clicking an edited line selects it for keyboard review. `M` moves down and `,` moves up, approving
the current line and selecting the next unchecked line in that direction, wrapping at the document
edge while expanding the destination file and folder as needed. The selected line carries a small
accent marker in the fixed review gutter. Keyboard navigation leaves an already-visible destination
in place and centers a destination that is outside the diff viewport.
Opening an inline comment from the line-number gutter does not select the line or recenter an older
line selection. The viewport stays fixed when the editor fits and otherwise moves only enough to
reveal the clipped editor. The comment editor retains keyboard focus until the reviewer leaves it.
Saved comments keep the fixed line-number gutter aligned with the code, including when comment text
wraps to two lines or multiple comments appear in one diff.
`Space` toggles without moving, `U` undoes the latest keyboard approval, `Escape` clears selection,
and `E` opens the nearest current-file line in a side-by-side built-in editor. Entirely deleted files
cannot be opened for editing. The selected-line shortcut widget also shows the current configured
shortcut for focusing Changes from another view (`Command+;` by default on macOS).

Line records use exact content, side, change type, and surrounding context. Unique unchanged edits
survive a new file revision. Repeated edits survive only when their count and ordinal position within
the same uniquely anchored region are unchanged; inserted, removed, or moved ambiguous repetitions
are cleared. Existing file-level records are materialized as reviewed lines the first time the
upgraded client observes that diff.
