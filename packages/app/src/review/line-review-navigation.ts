import type { ReviewableChangedLine } from "./line-review";

export type LineReviewKeyboardAction =
  | "clear"
  | "toggle"
  | "edit"
  | "undo"
  | "move-down"
  | "move-up";

export interface VerticalBounds {
  top: number;
  bottom: number;
}

export function getLineReviewKeyboardAction(key: string): LineReviewKeyboardAction | null {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "escape") return "clear";
  if (normalizedKey === " ") return "toggle";
  if (normalizedKey === "e") return "edit";
  if (normalizedKey === "u") return "undo";
  if (normalizedKey === "m") return "move-down";
  if (normalizedKey === ",") return "move-up";
  return null;
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
