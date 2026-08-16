import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";

export type ImageAttachment = AttachmentMetadata;

export interface MessagePayload {
  text: string;
  attachments: ComposerAttachment[];
  cwd: string;
  forceSend?: boolean;
  activeTurnBehavior?: ActiveTurnBehavior;
}
