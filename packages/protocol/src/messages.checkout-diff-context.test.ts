import { describe, expect, it } from "vitest";
import {
  CheckoutDiffGetContextRequestSchema,
  CheckoutDiffGetContextResponseSchema,
  ReviewAttachmentSchema,
  SubscribeCheckoutDiffResponseSchema,
} from "./messages";

describe("checkout diff context protocol", () => {
  it("accepts the namespaced request and response", () => {
    expect(
      CheckoutDiffGetContextRequestSchema.parse({
        type: "checkout.diff.get_context.request",
        cwd: "/repo",
        compare: { mode: "base", baseRef: "main" },
        filePath: "src/a.ts",
        region: { oldStart: 1, newStart: 1, lineCount: 20 },
        offset: 0,
        limit: 20,
        requestId: "request-1",
      }).type,
    ).toBe("checkout.diff.get_context.request");
    expect(
      CheckoutDiffGetContextResponseSchema.parse({
        type: "checkout.diff.get_context.response",
        payload: {
          cwd: "/repo",
          filePath: "src/a.ts",
          revision: "abc",
          region: { oldStart: 1, newStart: 1, lineCount: 20 },
          offset: 0,
          lines: [],
          hasMore: false,
          error: null,
          requestId: "request-1",
        },
      }).payload.error,
    ).toBeNull();
  });

  it("keeps legacy reviews valid and accepts structured suggestions and comment ranges", () => {
    const base = {
      type: "review" as const,
      mimeType: "application/paseo-review" as const,
      cwd: "/repo",
      mode: "base" as const,
      comments: [],
    };
    expect(ReviewAttachmentSchema.parse(base).suggestions).toBeUndefined();
    expect(
      ReviewAttachmentSchema.parse({
        ...base,
        comments: [
          {
            filePath: "src/a.ts",
            side: "new",
            lineNumber: 2,
            endLine: 3,
            body: "Review this block.",
            context: {
              hunkHeader: "@@ -2,2 +2,2 @@",
              targetLine: {
                oldLineNumber: 2,
                newLineNumber: 2,
                type: "context",
                content: "old",
              },
              lines: [],
            },
          },
        ],
      }).comments[0]?.endLine,
    ).toBe(3);
    expect(
      ReviewAttachmentSchema.parse({
        ...base,
        suggestions: [
          {
            filePath: "src/a.ts",
            startLine: 2,
            endLine: 3,
            originalLines: ["old", "code"],
            replacement: "new code",
            sourceRevision: "abc",
          },
        ],
      }).suggestions,
    ).toHaveLength(1);
  });

  it("accepts legacy diff files and opaque content revisions", () => {
    const response = {
      type: "subscribe_checkout_diff_response" as const,
      payload: {
        subscriptionId: "subscription-1",
        cwd: "/repo",
        files: [
          {
            path: "src/a.ts",
            isNew: false,
            isDeleted: false,
            additions: 1,
            deletions: 0,
            hunks: [],
          },
          {
            path: "src/b.ts",
            isNew: false,
            isDeleted: true,
            additions: 0,
            deletions: 1,
            hunks: [],
            contentRevision: "deleted:v1",
          },
        ],
        error: null,
        requestId: "request-1",
      },
    };

    const parsed = SubscribeCheckoutDiffResponseSchema.parse(response);
    expect(parsed.payload.files.map((file) => file.contentRevision)).toEqual([
      undefined,
      "deleted:v1",
    ]);
  });
});
