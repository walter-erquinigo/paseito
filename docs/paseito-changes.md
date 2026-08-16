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
