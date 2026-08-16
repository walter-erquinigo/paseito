# Semantic reconciliation policy

## Evidence standard

An upstream implementation replaces a local feature only when all of these are true:

1. Every registry invariant is present in executable upstream behavior.
2. Contract checks pass on a pristine checkout of the new upstream commit, or the decision records
   an equivalent probe with its exact command and result.
3. Removing the Paseito implementation leaves no residual user-visible behavior, persistence,
   protocol compatibility, or migration requirement.
4. A separate read-only reviewer can locate the same evidence.

Use `adapt` when upstream is partial. Use `blocked` rather than guessing.

## Git policy

- Preserve logically separated Paseito commits when practical.
- It is acceptable to drop, split, or rewrite a local commit when the decision report explains why.
- The new upstream commit must be an ancestor of the final candidate.
- Leave only intentional semantic edits; the controller stages and commits them, then requires a
  clean worktree before review.

## Verification policy

Run the narrow contract checks during reconciliation. The outer controller runs formatting, lint,
typechecking, focused fork tests, and deterministic GitHub packaging afterward. Do not weaken,
delete, skip, or rewrite a failing test merely to make the candidate pass.
