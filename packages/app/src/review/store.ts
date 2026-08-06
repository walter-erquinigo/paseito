import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ComposerAttachment } from "@/attachments/types";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import {
  addCommentToState,
  addSuggestionToState,
  clearReviewInState,
  deleteCommentFromState,
  deleteSuggestionFromState,
  type DiffModeOverride,
  expireStaleDiffModeOverridesInState,
  normalizePersistedState,
  resolveDiffMode,
  type ReviewDraftComment,
  type ReviewDraftMode,
  type ReviewDraftSuggestion,
  type ReviewDraftSide,
  type ReviewDraftStoreState,
  serializeReviewDraftState,
  setDiffModeOverrideInState,
  updateCommentInState,
  updateSuggestionInState,
} from "@/review/state";
import { generateMessageId } from "@/types/stream";
import { buildNumberedDiffHunks, type NumberedDiffLine } from "@/utils/diff-layout";
import type { AgentAttachment } from "@getpaseo/protocol/messages";

export type {
  DiffModeOverride,
  ReviewDraftComment,
  ReviewDraftMode,
  ReviewDraftSide,
  ReviewDraftSuggestion,
} from "@/review/state";

// v2 dropped persisted activeModesByScope (diff mode overrides are in-memory only).
const STORE_VERSION = 3;
const CONTEXT_RADIUS = 3;
const EMPTY_REVIEW_DRAFT_COMMENTS: ReviewDraftComment[] = [];
const EMPTY_REVIEW_DRAFT_SUGGESTIONS: ReviewDraftSuggestion[] = [];

type ReviewAttachment = Extract<AgentAttachment, { type: "review" }>;
type ReviewAttachmentContextLine = ReviewAttachment["comments"][number]["context"]["targetLine"];
type ReviewComposerAttachment = Extract<ComposerAttachment, { kind: "review" }>;

export interface BuildReviewDraftKeyInput {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  mode: ReviewDraftMode;
  baseRef?: string | null;
  ignoreWhitespace: boolean;
}

export type BuildReviewDraftScopeKeyInput = Omit<BuildReviewDraftKeyInput, "mode">;

export interface BuildReviewAttachmentSnapshotInput {
  reviewDraftKey: string;
  cwd: string;
  mode: ReviewDraftMode;
  baseRef?: string | null;
  comments: readonly ReviewDraftComment[];
  suggestions?: readonly ReviewDraftSuggestion[];
  diffFiles: readonly ParsedDiffFile[];
}

export type ReviewDraftCommentInput = Omit<ReviewDraftComment, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<ReviewDraftComment, "id" | "createdAt" | "updatedAt">>;

interface ReviewDraftStoreActions {
  setDiffModeOverride: (input: { scopeKey: string; override: DiffModeOverride }) => void;
  addComment: (input: { key: string; comment: ReviewDraftCommentInput }) => ReviewDraftComment;
  updateComment: (input: {
    key: string;
    id: string;
    updates: Partial<Pick<ReviewDraftComment, "body">>;
    updatedAt?: string;
  }) => void;
  deleteComment: (input: { key: string; id: string }) => void;
  addSuggestion: (input: {
    key: string;
    suggestion: Omit<ReviewDraftSuggestion, "id" | "createdAt" | "updatedAt">;
  }) => ReviewDraftSuggestion;
  updateSuggestion: (input: {
    key: string;
    id: string;
    updates: Partial<
      Pick<ReviewDraftSuggestion, "replacement" | "note" | "sourceRevision" | "originalLines">
    >;
  }) => void;
  deleteSuggestion: (input: { key: string; id: string }) => void;
  clearReview: (input: { key: string }) => void;
}

type ReviewDraftStore = ReviewDraftStoreState & ReviewDraftStoreActions;

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeBaseRef(baseRef: string | null | undefined): string {
  return baseRef?.trim() ?? "";
}

function buildReviewDraftScopeParts(input: BuildReviewDraftScopeKeyInput): string[] {
  const workspaceId = input.workspaceId?.trim();
  // workspaceId is opaque; do not parse this key back into a path.
  const workspacePart = workspaceId
    ? `workspace=${encodeKeyPart(workspaceId)}`
    : `cwd=${encodeKeyPart(normalizeCwd(input.cwd))}`;

  return [
    "review",
    `server=${encodeKeyPart(input.serverId)}`,
    workspacePart,
    `base=${encodeKeyPart(normalizeBaseRef(input.baseRef))}`,
    `ignoreWhitespace=${input.ignoreWhitespace ? "true" : "false"}`,
  ];
}

export function buildReviewDraftScopeKey(input: BuildReviewDraftScopeKeyInput): string {
  return buildReviewDraftScopeParts(input).join(":");
}

export function buildReviewDraftKey(input: BuildReviewDraftKeyInput): string {
  const [prefix, serverPart, workspacePart, basePart, whitespacePart] =
    buildReviewDraftScopeParts(input);
  return [prefix, serverPart, workspacePart, `mode=${input.mode}`, basePart, whitespacePart].join(
    ":",
  );
}

function createDraftComment(input: ReviewDraftCommentInput): ReviewDraftComment {
  const now = new Date().toISOString();
  return {
    id: input.id ?? generateMessageId(),
    filePath: input.filePath,
    side: input.side,
    lineNumber: input.lineNumber,
    body: input.body,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };
}

export const useReviewDraftStore = create<ReviewDraftStore>()(
  persist(
    (set) => ({
      drafts: {},
      suggestions: {},
      diffModeOverrides: {},
      setDiffModeOverride: (input) => {
        set((state) => setDiffModeOverrideInState(state, input));
      },
      addComment: ({ key, comment }) => {
        const nextComment = createDraftComment(comment);
        set((state) => addCommentToState(state, { key, comment: nextComment }));
        return nextComment;
      },
      updateComment: ({ key, id, updates, updatedAt }) => {
        set((state) =>
          updateCommentInState(state, {
            key,
            id,
            updates,
            updatedAt: updatedAt ?? new Date().toISOString(),
          }),
        );
      },
      deleteComment: (input) => {
        set((state) => deleteCommentFromState(state, input));
      },
      addSuggestion: ({ key, suggestion }) => {
        const now = new Date().toISOString();
        const nextSuggestion: ReviewDraftSuggestion = {
          ...suggestion,
          id: generateMessageId(),
          createdAt: now,
          updatedAt: now,
        };
        set((state) => addSuggestionToState(state, { key, suggestion: nextSuggestion }));
        return nextSuggestion;
      },
      updateSuggestion: ({ key, id, updates }) => {
        set((state) =>
          updateSuggestionInState(state, {
            key,
            id,
            updates,
            updatedAt: new Date().toISOString(),
          }),
        );
      },
      deleteSuggestion: (input) => {
        set((state) => deleteSuggestionFromState(state, input));
      },
      clearReview: (input) => {
        set((state) => clearReviewInState(state, input));
      },
    }),
    {
      name: "@paseo:review-draft-store",
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => serializeReviewDraftState(state),
      migrate: async (state) => normalizePersistedState(state),
    },
  ),
);

function toContextLine(line: NumberedDiffLine): ReviewAttachmentContextLine | null {
  if (line.line.type === "header") {
    return null;
  }
  return {
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
    type: line.line.type,
    content: line.line.content,
  };
}

function findTarget(input: { comment: ReviewDraftComment; diffFiles: readonly ParsedDiffFile[] }): {
  hunkHeader: string;
  hunkLines: NumberedDiffLine[];
  targetIndex: number;
  targetLine: NumberedDiffLine;
} | null {
  const file = input.diffFiles.find((candidate) => candidate.path === input.comment.filePath);
  if (!file) {
    return null;
  }

  for (const hunk of buildNumberedDiffHunks(file)) {
    const targetIndex = hunk.lines.findIndex((line) => {
      const cell = input.comment.side === "old" ? line.oldCell : line.newCell;
      return cell?.lineNumber === input.comment.lineNumber;
    });
    const targetLine = hunk.lines[targetIndex];
    if (targetLine) {
      return {
        hunkHeader: hunk.hunkHeader,
        hunkLines: hunk.lines,
        targetIndex,
        targetLine,
      };
    }
  }

  return null;
}

export function buildReviewAttachmentSnapshot(
  input: BuildReviewAttachmentSnapshotInput,
): ReviewComposerAttachment | null {
  const comments: ReviewAttachment["comments"] = [];
  const currentRevisionByPath = new Map(
    input.diffFiles.map((file) => [file.path, file.revision] as const),
  );
  const suggestions = (input.suggestions ?? []).filter(
    (suggestion) => currentRevisionByPath.get(suggestion.filePath) === suggestion.sourceRevision,
  );
  const staleSuggestionCount = (input.suggestions?.length ?? 0) - suggestions.length;

  for (const draftComment of input.comments) {
    const target = findTarget({
      comment: draftComment,
      diffFiles: input.diffFiles,
    });
    if (!target) {
      continue;
    }

    const targetLine = toContextLine(target.targetLine);
    if (!targetLine) {
      continue;
    }

    const contextStart = Math.max(0, target.targetIndex - CONTEXT_RADIUS);
    const contextEnd = Math.min(target.hunkLines.length, target.targetIndex + CONTEXT_RADIUS + 1);
    const lines = target.hunkLines
      .slice(contextStart, contextEnd)
      .map(toContextLine)
      .filter((line): line is ReviewAttachmentContextLine => line !== null);

    comments.push({
      filePath: draftComment.filePath,
      side: draftComment.side,
      lineNumber: draftComment.lineNumber,
      body: draftComment.body,
      context: {
        hunkHeader: target.hunkHeader,
        targetLine,
        lines,
      },
    });
  }

  if (comments.length === 0 && suggestions.length === 0 && staleSuggestionCount === 0) {
    return null;
  }

  const attachment: ReviewAttachment = {
    type: "review",
    mimeType: "application/paseo-review",
    cwd: input.cwd,
    mode: input.mode,
    baseRef: normalizeBaseRef(input.baseRef) || null,
    comments,
    ...(suggestions.length > 0
      ? {
          suggestions: suggestions.map((suggestion) => {
            const wireSuggestion: NonNullable<ReviewAttachment["suggestions"]>[number] = {
              filePath: suggestion.filePath,
              startLine: suggestion.startLine,
              endLine: suggestion.endLine,
              originalLines: suggestion.originalLines,
              replacement: suggestion.replacement,
              sourceRevision: suggestion.sourceRevision,
            };
            if (suggestion.note.trim()) wireSuggestion.note = suggestion.note.trim();
            return wireSuggestion;
          }),
        }
      : {}),
  };

  return {
    kind: "review",
    reviewDraftKey: input.reviewDraftKey,
    commentCount: comments.length + (input.suggestions?.length ?? 0),
    ...(staleSuggestionCount > 0
      ? { blockingReason: "A code suggestion is stale. Edit, rebase, or delete it before sending." }
      : {}),
    attachment,
  };
}

export function useReviewDraftComments(key: string): ReviewDraftComment[] {
  return useReviewDraftStore((state) => state.drafts[key] ?? EMPTY_REVIEW_DRAFT_COMMENTS);
}

export function useReviewDraftSuggestions(key: string): ReviewDraftSuggestion[] {
  return useReviewDraftStore((state) => state.suggestions[key] ?? EMPTY_REVIEW_DRAFT_SUGGESTIONS);
}

export function useSetDiffModeOverride(): ReviewDraftStoreActions["setDiffModeOverride"] {
  return useReviewDraftStore((state) => state.setDiffModeOverride);
}

// Non-React entry point: called from the checkout-status data boundary, where dirty-state
// changes enter the app regardless of which screens are mounted.
export function expireStaleDiffModeOverrides(input: {
  serverId: string;
  cwd: string;
  isDirty: boolean;
}): void {
  useReviewDraftStore.setState((state) => expireStaleDiffModeOverridesInState(state, input));
}

export function useClearReviewDraft(): ReviewDraftStoreActions["clearReview"] {
  return useReviewDraftStore((state) => state.clearReview);
}

export function addReviewDraftComment(input: {
  key: string;
  comment: ReviewDraftCommentInput;
}): ReviewDraftComment {
  return useReviewDraftStore.getState().addComment(input);
}

export function getReviewDraftComments(key: string): ReviewDraftComment[] | undefined {
  return useReviewDraftStore.getState().drafts[key];
}

export function resetReviewDraftStore(): void {
  useReviewDraftStore.setState({ drafts: {}, suggestions: {}, diffModeOverrides: {} });
}

export function useReviewDraftCommentsForAttachment(input: {
  key: string;
  enabled: boolean;
}): ReviewDraftComment[] {
  return useReviewDraftStore((state) =>
    input.enabled
      ? (state.drafts[input.key] ?? EMPTY_REVIEW_DRAFT_COMMENTS)
      : EMPTY_REVIEW_DRAFT_COMMENTS,
  );
}

export function useReviewCommentCount(key: string): number {
  return useReviewDraftStore((state) => state.drafts[key]?.length ?? 0);
}

export function useResolvedDiffMode(input: {
  scopeKey: string;
  hasUncommittedChanges: boolean;
}): ReviewDraftMode {
  return useReviewDraftStore((state) =>
    resolveDiffMode({
      override: state.diffModeOverrides[input.scopeKey],
      hasUncommittedChanges: input.hasUncommittedChanges,
    }),
  );
}

export function useReviewAttachmentSnapshot(input: {
  key: string;
  diffFiles: readonly ParsedDiffFile[];
  cwd: string;
  mode: ReviewDraftMode;
  baseRef?: string | null;
}): ReviewComposerAttachment | null {
  const comments = useReviewDraftComments(input.key);
  const suggestions = useReviewDraftSuggestions(input.key);
  return useMemo(
    () =>
      buildReviewAttachmentSnapshot({
        reviewDraftKey: input.key,
        cwd: input.cwd,
        mode: input.mode,
        baseRef: input.baseRef,
        comments,
        suggestions,
        diffFiles: input.diffFiles,
      }),
    [comments, suggestions, input.key, input.cwd, input.mode, input.baseRef, input.diffFiles],
  );
}
