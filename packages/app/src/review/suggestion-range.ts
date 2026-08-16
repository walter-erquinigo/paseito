import type { ReviewableDiffTarget } from "@/utils/diff-layout";

export const MAX_SUGGESTION_RANGE_LINES = 200;

export type SuggestionRangeFailure =
  | "different-file"
  | "different-revision"
  | "hidden-lines"
  | "invalid-side"
  | "too-large";

export type SuggestionRangeResult =
  | { ok: true; targets: ReviewableDiffTarget[] }
  | { ok: false; reason: SuggestionRangeFailure };

export function isSuggestibleTarget(target: ReviewableDiffTarget): boolean {
  return (
    target.side === "new" &&
    (target.lineType === "add" || target.lineType === "context") &&
    Boolean(target.sourceRevision)
  );
}

export function editableSuggestionTargetContent(target: ReviewableDiffTarget): string {
  return /^[+ ]/.test(target.content) ? target.content.slice(1) : target.content;
}

export function buildSuggestionRange(input: {
  anchor: ReviewableDiffTarget;
  focus: ReviewableDiffTarget;
  availableTargets: readonly ReviewableDiffTarget[];
}): SuggestionRangeResult {
  const { anchor, focus, availableTargets } = input;
  if (!isSuggestibleTarget(anchor) || !isSuggestibleTarget(focus)) {
    return { ok: false, reason: "invalid-side" };
  }
  if (anchor.filePath !== focus.filePath) {
    return { ok: false, reason: "different-file" };
  }
  if (anchor.sourceRevision !== focus.sourceRevision) {
    return { ok: false, reason: "different-revision" };
  }

  const startLine = Math.min(anchor.lineNumber, focus.lineNumber);
  const endLine = Math.max(anchor.lineNumber, focus.lineNumber);
  if (endLine - startLine + 1 > MAX_SUGGESTION_RANGE_LINES) {
    return { ok: false, reason: "too-large" };
  }

  const targetByLine = new Map<number, ReviewableDiffTarget>();
  for (const target of availableTargets) {
    if (
      target.filePath === anchor.filePath &&
      target.sourceRevision === anchor.sourceRevision &&
      target.lineNumber >= startLine &&
      target.lineNumber <= endLine &&
      isSuggestibleTarget(target)
    ) {
      targetByLine.set(target.lineNumber, target);
    }
  }

  const targets: ReviewableDiffTarget[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const target = targetByLine.get(lineNumber);
    if (!target) {
      return { ok: false, reason: "hidden-lines" };
    }
    targets.push(target);
  }
  return { ok: true, targets };
}
