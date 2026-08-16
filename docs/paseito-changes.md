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
