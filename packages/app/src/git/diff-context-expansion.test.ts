import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  buildDiffContextRegions,
  parseDiffContextMarker,
  withExpandedDiffContext,
} from "./diff-context-expansion";

function file(): ParsedDiffFile {
  return {
    path: "src/example.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 1,
    status: "ok",
    oldLineCount: 20,
    newLineCount: 20,
    revision: "revision-1",
    hunks: [
      {
        oldStart: 9,
        oldCount: 3,
        newStart: 9,
        newCount: 3,
        lines: [{ type: "header", content: "@@ -9,3 +9,3 @@" }],
      },
    ],
  };
}

describe("diff context expansion", () => {
  it("finds omitted regions before and after hunks", () => {
    expect(buildDiffContextRegions(file())).toEqual([
      { oldStart: 1, newStart: 1, lineCount: 8 },
      { oldStart: 12, newStart: 12, lineCount: 9 },
    ]);
  });

  it("splits omitted regions around loaded context", () => {
    const expanded = withExpandedDiffContext(file(), [
      { oldLineNumber: 3, newLineNumber: 3, content: "line 3" },
      { oldLineNumber: 4, newLineNumber: 4, content: "line 4" },
    ]);
    const markers = expanded.hunks
      .flatMap((hunk) => hunk.lines)
      .map((line) => parseDiffContextMarker(line.content))
      .filter(Boolean);
    expect(markers).toEqual([
      { oldStart: 1, newStart: 1, lineCount: 2 },
      { oldStart: 5, newStart: 5, lineCount: 4 },
      { oldStart: 12, newStart: 12, lineCount: 9 },
    ]);
    expect(expanded.hunks.some((hunk) => hunk.newStart === 3 && hunk.newCount === 2)).toBe(true);
  });
});
