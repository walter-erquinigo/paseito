import { describe, expect, it } from "vitest";
import {
  buildReviewAttachmentListItems,
  getReviewAttachmentEntryCount,
  type ReviewAttachment,
} from "@/attachments/review-attachment-items";

const attachment: ReviewAttachment = {
  type: "review",
  mimeType: "application/paseo-review",
  cwd: "/workspace",
  mode: "uncommitted",
  comments: [
    {
      filePath: "src/new.ts",
      side: "new",
      lineNumber: 12,
      body: "Keep the public name stable.",
      context: {
        hunkHeader: "@@ -10,3 +10,4 @@",
        targetLine: { oldLineNumber: null, newLineNumber: 12, type: "add", content: "next" },
        lines: [],
      },
    },
    {
      filePath: "src/old.ts",
      side: "old",
      lineNumber: 8,
      body: "Why remove this guard?",
      context: {
        hunkHeader: "@@ -8,2 +8,1 @@",
        targetLine: { oldLineNumber: 8, newLineNumber: null, type: "remove", content: "guard" },
        lines: [],
      },
    },
    {
      filePath: "src/range.ts",
      side: "new",
      lineNumber: 14,
      endLine: 16,
      body: "Keep this block together.",
      context: {
        hunkHeader: "@@ -14,3 +14,3 @@",
        targetLine: { oldLineNumber: 14, newLineNumber: 14, type: "context", content: "first" },
        lines: [],
      },
    },
  ],
  suggestions: [
    {
      filePath: "src/change.ts",
      startLine: 20,
      endLine: 22,
      originalLines: ["before"],
      replacement: "after",
      note: "Use the normalized value.",
      sourceRevision: "revision-1",
    },
  ],
};

describe("review attachment list items", () => {
  it("builds readable locations for added and removed-line comments", () => {
    expect(buildReviewAttachmentListItems(attachment).slice(0, 3)).toEqual([
      {
        key: "comment:src/new.ts:new:12:0",
        kind: "comment",
        location: "src/new.ts · +12",
        body: "Keep the public name stable.",
      },
      {
        key: "comment:src/old.ts:old:8:1",
        kind: "comment",
        location: "src/old.ts · -8",
        body: "Why remove this guard?",
      },
      {
        key: "comment:src/range.ts:new:14:16:2",
        kind: "comment",
        location: "src/range.ts · +14–16",
        body: "Keep this block together.",
      },
    ]);
  });

  it("includes code changes in the visible entry count and list", () => {
    expect(getReviewAttachmentEntryCount(attachment)).toBe(4);
    expect(buildReviewAttachmentListItems(attachment)[3]).toEqual({
      key: "suggestion:src/change.ts:20:22:0",
      kind: "suggestion",
      location: "src/change.ts · L20–22",
      body: "Use the normalized value.",
    });
  });
});
