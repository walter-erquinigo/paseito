import { describe, expect, it } from "vitest";
import {
  CheckoutDiffGetContextRequestSchema,
  CheckoutDiffGetContextResponseSchema,
  ReviewAttachmentSchema,
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

  it("keeps legacy reviews valid and accepts structured suggestions", () => {
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
});
