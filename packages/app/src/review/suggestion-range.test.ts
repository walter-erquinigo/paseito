import { describe, expect, it } from "vitest";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import { buildSuggestionRange, MAX_SUGGESTION_RANGE_LINES } from "./suggestion-range";

function target(lineNumber: number, overrides: Partial<ReviewableDiffTarget> = {}) {
  const filePath = overrides.filePath ?? "src/example.ts";
  const side = overrides.side ?? "new";
  return {
    filePath,
    hunkHeader: "@@ -1,3 +1,3 @@",
    hunkIndex: overrides.hunkIndex ?? 0,
    lineIndex: lineNumber,
    oldLineNumber: lineNumber,
    newLineNumber: lineNumber,
    side,
    lineNumber,
    lineType: "context",
    content: ` line ${lineNumber}`,
    sourceRevision: "revision-1",
    ...overrides,
    key: buildReviewableDiffTargetKey({ filePath, side, lineNumber }),
  } satisfies ReviewableDiffTarget;
}

describe("buildSuggestionRange", () => {
  it("orders a reverse selection by current line number across synthetic hunks", () => {
    const targets = [target(10), target(11, { hunkIndex: 4 }), target(12, { hunkIndex: 9 })];
    expect(
      buildSuggestionRange({ anchor: targets[2], focus: targets[0], availableTargets: targets }),
    ).toEqual({ ok: true, targets });
  });

  it("requires hidden context to be expanded before completing the range", () => {
    const first = target(10);
    const last = target(12);
    expect(
      buildSuggestionRange({ anchor: first, focus: last, availableTargets: [first, last] }),
    ).toEqual({ ok: false, reason: "hidden-lines" });
  });

  it("rejects deleted-side, cross-file, cross-revision, and oversized selections", () => {
    const first = target(1);
    expect(
      buildSuggestionRange({
        anchor: first,
        focus: target(2, { side: "old", lineType: "remove" }),
        availableTargets: [first],
      }),
    ).toEqual({ ok: false, reason: "invalid-side" });
    expect(
      buildSuggestionRange({
        anchor: first,
        focus: target(2, { filePath: "src/other.ts" }),
        availableTargets: [first],
      }),
    ).toEqual({ ok: false, reason: "different-file" });
    expect(
      buildSuggestionRange({
        anchor: first,
        focus: target(2, { sourceRevision: "revision-2" }),
        availableTargets: [first],
      }),
    ).toEqual({ ok: false, reason: "different-revision" });
    expect(
      buildSuggestionRange({
        anchor: first,
        focus: target(MAX_SUGGESTION_RANGE_LINES + 1),
        availableTargets: [first],
      }),
    ).toEqual({ ok: false, reason: "too-large" });
  });
});
