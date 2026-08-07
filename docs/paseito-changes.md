# Paseito Changes extensions

Paseito adds three capability-gated review features to the Changes view.

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

Starting a comment on a current-side added or context line exposes **Suggest edit**. A suggestion can
grow to adjacent lines in the same displayed hunk, up to 200 lines, and contains replacement text
plus an optional note. An empty replacement means deletion. Suggestions are persisted with their
original source and file revision and are included in the review attachment sent to the destination
agent. They never edit the checkout or post to GitHub/GitLab.

When the file revision changes, the suggestion remains visible as stale. Sending is blocked until
the reviewer edits it against the current lines or deletes it; Paseito never silently remaps it.
Older daemons continue to support ordinary diffs and comments but do not expose context expansion or
suggestions.
