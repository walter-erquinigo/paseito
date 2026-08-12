import { describe, expect, it } from "vitest";
import type { ReviewableChangedLine } from "./line-review";
import {
  findNextUncheckedLine,
  getLineReviewKeyboardAction,
  isReviewTargetFullyVisible,
} from "./line-review-navigation";

function line(id: string): ReviewableChangedLine {
  return {
    id,
    fingerprint: id,
    occurrence: 0,
    target: {
      key: id,
      filePath: id.startsWith("b") ? "b.ts" : "a.ts",
      hunkHeader: "@@",
      hunkIndex: 0,
      lineIndex: 0,
      oldLineNumber: null,
      newLineNumber: 1,
      side: "new",
      lineNumber: 1,
      lineType: "add",
      content: `+${id}`,
    },
  };
}

describe("line review navigation", () => {
  const lines = [line("a1"), line("a2"), line("b1"), line("b2")];

  it("skips reviewed lines and crosses file boundaries", () => {
    expect(
      findNextUncheckedLine({
        lines,
        selectedLineId: "a1",
        reviewedLineIds: new Set(["a1", "a2"]),
        direction: "down",
      })?.id,
    ).toBe("b1");
  });

  it("moves upward without wrapping", () => {
    expect(
      findNextUncheckedLine({
        lines,
        selectedLineId: "b2",
        reviewedLineIds: new Set(["a2", "b1", "b2"]),
        direction: "up",
      })?.id,
    ).toBe("a1");
    expect(
      findNextUncheckedLine({
        lines,
        selectedLineId: "a1",
        reviewedLineIds: new Set(),
        direction: "up",
      }),
    ).toBeNull();
  });

  it("maps M and comma to directional review actions without retaining J or K", () => {
    expect(getLineReviewKeyboardAction("m")).toBe("move-down");
    expect(getLineReviewKeyboardAction("M")).toBe("move-down");
    expect(getLineReviewKeyboardAction(",")).toBe("move-up");
    expect(getLineReviewKeyboardAction("j")).toBeNull();
    expect(getLineReviewKeyboardAction("k")).toBeNull();
  });

  it("keeps the non-navigation review actions unchanged", () => {
    expect(getLineReviewKeyboardAction("Escape")).toBe("clear");
    expect(getLineReviewKeyboardAction(" ")).toBe("toggle");
    expect(getLineReviewKeyboardAction("E")).toBe("edit");
    expect(getLineReviewKeyboardAction("u")).toBe("undo");
    expect(getLineReviewKeyboardAction("x")).toBeNull();
  });

  it("keeps a fully visible review target in place", () => {
    expect(
      isReviewTargetFullyVisible({
        viewport: { top: 100, bottom: 500 },
        target: { top: 180, bottom: 204 },
      }),
    ).toBe(true);
  });

  it("detects review targets outside either viewport edge", () => {
    expect(
      isReviewTargetFullyVisible({
        viewport: { top: 100, bottom: 500 },
        target: { top: 620, bottom: 644 },
      }),
    ).toBe(false);
    expect(
      isReviewTargetFullyVisible({
        viewport: { top: 100, bottom: 500 },
        target: { top: 20, bottom: 44 },
      }),
    ).toBe(false);
  });
});
