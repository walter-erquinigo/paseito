import type { AgentAttachment } from "@getpaseo/protocol/messages";

export type ReviewAttachment = Extract<AgentAttachment, { type: "review" }>;

export interface ReviewAttachmentListItem {
  key: string;
  kind: "comment" | "suggestion";
  location: string;
  body: string | null;
}

export function getReviewAttachmentEntryCount(attachment: ReviewAttachment): number {
  return attachment.comments.length + (attachment.suggestions?.length ?? 0);
}

export function buildReviewAttachmentListItems(
  attachment: ReviewAttachment,
): ReviewAttachmentListItem[] {
  const comments = attachment.comments.map<ReviewAttachmentListItem>((comment, index) => ({
    key: `comment:${comment.filePath}:${comment.side}:${comment.lineNumber}:${index}`,
    kind: "comment",
    location: `${comment.filePath} · ${comment.side === "old" ? "-" : "+"}${comment.lineNumber}`,
    body: comment.body,
  }));
  const suggestions = (attachment.suggestions ?? []).map<ReviewAttachmentListItem>(
    (suggestion, index) => ({
      key: `suggestion:${suggestion.filePath}:${suggestion.startLine}:${suggestion.endLine}:${index}`,
      kind: "suggestion",
      location: `${suggestion.filePath} · L${suggestion.startLine}${
        suggestion.endLine === suggestion.startLine ? "" : `–${suggestion.endLine}`
      }`,
      body: suggestion.note?.trim() || null,
    }),
  );
  return [...comments, ...suggestions];
}
