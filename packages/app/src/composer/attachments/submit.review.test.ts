import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "@/attachments/types";
import { splitComposerAttachmentsForSubmit } from "./submit";

function reviewAttachment(blockingReason?: string): ComposerAttachment {
  return {
    kind: "review",
    reviewDraftKey: "review:key",
    commentCount: 1,
    ...(blockingReason ? { blockingReason } : {}),
    attachment: {
      type: "review",
      mimeType: "application/paseo-review",
      cwd: "/repo",
      mode: "base",
      comments: [],
      suggestions: [
        {
          filePath: "src/a.ts",
          startLine: 1,
          endLine: 1,
          originalLines: ["old"],
          replacement: "new",
          sourceRevision: "revision-1",
        },
      ],
    },
  };
}

describe("review attachment submission", () => {
  it("sends a current structured suggestion to the agent", () => {
    expect(splitComposerAttachmentsForSubmit([reviewAttachment()]).attachments[0]).toMatchObject({
      type: "review",
      suggestions: [{ replacement: "new" }],
    });
  });

  it("blocks a stale suggestion before submission", () => {
    expect(() =>
      splitComposerAttachmentsForSubmit([reviewAttachment("Suggestion is stale")]),
    ).toThrow("Suggestion is stale");
  });
});
