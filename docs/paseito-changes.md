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

When the file revision changes, the suggestion remains visible as stale. Sending is blocked until
the reviewer edits it against the current lines or deletes it; Paseito never silently remaps it.
Older daemons continue to support ordinary diffs and comments but do not expose context expansion or
suggestions.

## Reviewed files

Each file header can be marked reviewed. The private local record is scoped by host, main repository,
branch, and exact file path, while the daemon-provided content revision determines whether the check
is still valid. Amending or rebasing a branch therefore preserves checks for identical branch-side
content regardless of the selected comparison base or diff mode.

Marking a file reviewed collapses it. If its content revision changes, Paseito clears the visible
check and reopens the file once; returning to the reviewed content restores the check. The toolbar
shows reviewed progress and can mark and collapse, or clear, every file in the current diff. The same
records are used by Committed and Uncommitted views, but are not committed, synchronized, sent to an
agent, or posted to a forge. Older daemons expose an update-host message instead of attempting to
infer content identity from patch text.
