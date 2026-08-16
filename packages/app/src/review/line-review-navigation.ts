import type { DiffContextRegion } from "@/git/diff-context-expansion";
import type { ReviewableChangedLine } from "./line-review";

export type LineReviewKeyboardAction =
  | "clear"
  | "toggle"
  | "edit"
  | "undo"
  | "move-down"
  | "move-up"
  | "expand-below"
  | "expand-above";

export interface VerticalBounds {
  top: number;
  bottom: number;
}

export function getLineReviewKeyboardAction(key: string): LineReviewKeyboardAction | null {
  if (key === "M") return "expand-below";
  if (key === ">") return "expand-above";
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "escape") return "clear";
  if (normalizedKey === " ") return "toggle";
  if (normalizedKey === "e") return "edit";
  if (normalizedKey === "u") return "undo";
  if (key === "m") return "move-down";
  if (normalizedKey === ",") return "move-up";
  return null;
}

export function shouldCenterReviewTarget(input: {
  isFullyVisible: boolean;
  renderedLinesAfter: number;
  visibleLinesAfter: number;
}): boolean {
  if (!input.isFullyVisible) return true;
  return input.renderedLinesAfter >= 5 && input.visibleLinesAfter < 5;
}

export function findAdjacentHiddenContext(input: {
  regions: readonly DiffContextRegion[];
  lineNumber: number;
  direction: "above" | "below";
}): DiffContextRegion | null {
  const ordered = [...input.regions].sort((left, right) => left.newStart - right.newStart);
  if (input.direction === "below") {
    return ordered.find((region) => region.newStart > input.lineNumber) ?? null;
  }
  return (
    ordered.findLast((region) => region.newStart + region.lineCount - 1 < input.lineNumber) ?? null
  );
}

export function findNextUncheckedLine(input: {
  lines: readonly ReviewableChangedLine[];
  selectedLineId: string;
  reviewedLineIds: ReadonlySet<string>;
  direction: "up" | "down";
}): ReviewableChangedLine | null {
  const selectedIndex = input.lines.findIndex((line) => line.id === input.selectedLineId);
  if (selectedIndex < 0) return null;
  const step = input.direction === "down" ? 1 : -1;
  for (let index = selectedIndex + step; index >= 0 && index < input.lines.length; index += step) {
    const line = input.lines[index];
    if (line && !input.reviewedLineIds.has(line.id)) return line;
  }
  return null;
}

export function isReviewTargetFullyVisible(input: {
  viewport: VerticalBounds;
  target: VerticalBounds;
}): boolean {
  return input.target.top >= input.viewport.top && input.target.bottom <= input.viewport.bottom;
}
