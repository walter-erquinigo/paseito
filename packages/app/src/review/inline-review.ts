import type { ReviewableDiffTarget } from "@/utils/diff-layout";
import type { ReviewDraftComment, ReviewDraftSuggestion } from "./store";
import type { SuggestionRangeFailure } from "./suggestion-range";
import type { ChangesDiscussionThread } from "@/git/changes-discussions";

export const INLINE_REVIEW_COMMENT_HEIGHT = 74;
export const INLINE_REVIEW_EDITOR_HEIGHT = 168;
export const INLINE_SUGGESTION_EDITOR_HEIGHT = 316;
export const INLINE_SUGGESTION_HEIGHT = 112;
export const INLINE_FORGE_DISCUSSION_HEIGHT = 74;
export const INLINE_RESOLVED_FORGE_DISCUSSION_HEIGHT = 38;
const INLINE_REVIEW_GAP = 6;

export interface InlineReviewEditorState {
  targets: ReviewableDiffTarget[];
  commentId: string | null;
  body: string;
}

export interface InlineSuggestionEditorState {
  targets: ReviewableDiffTarget[];
  suggestionId: string | null;
  replacement: string;
  note: string;
  sourceRevision: string;
}

export interface InlineReviewActions {
  canSuggest: boolean;
  composerMode: "comment" | "suggestion" | null;
  commentsByTarget: ReadonlyMap<string, ReviewDraftComment[]>;
  editor: InlineReviewEditorState | null;
  suggestionsByTarget: ReadonlyMap<string, ReviewDraftSuggestion[]>;
  suggestionEditor: InlineSuggestionEditorState | null;
  selectedRangeTargetKeys: ReadonlySet<string>;
  suggestionRangeError: SuggestionRangeFailure | null;
  forgeThreadsByTarget?: ReadonlyMap<string, ChangesDiscussionThread[]>;
  onOpenForgeThread?: (threadId: string) => void;
  onStartComment(target: ReviewableDiffTarget): void;
  onEditComment(target: ReviewableDiffTarget, comment: ReviewDraftComment): void;
  onCancelEditor(): void;
  onSaveEditor(body: string): void;
  onDeleteComment(id: string): void;
  onStartSuggestion(target: ReviewableDiffTarget, note?: string): void;
  onSwitchSuggestionToComment(replacement: string, note: string): void;
  onBeginSuggestionDrag(target: ReviewableDiffTarget): void;
  onUpdateSuggestionDrag(target: ReviewableDiffTarget): void;
  onShiftSuggestionRange(target: ReviewableDiffTarget): void;
  onPressReviewGutter(target: ReviewableDiffTarget): void;
  onCancelSuggestionRange(): void;
  onClearSuggestionRangeError(): void;
  onCancelSuggestion(): void;
  onEditSuggestion(suggestion: ReviewDraftSuggestion): void;
  onExtendSuggestion(direction: "up" | "down"): void;
  onSaveSuggestion(replacement: string, note: string): void;
  onDeleteSuggestion(id: string): void;
}

export function isInlineReviewEditorForTarget(
  editor: InlineReviewEditorState | null,
  target: ReviewableDiffTarget | null | undefined,
): boolean {
  return Boolean(editor && target && editor.targets.at(-1)?.key === target.key);
}

function activeCommentEditorForTarget(
  reviewActions: InlineReviewActions,
  reviewTarget: ReviewableDiffTarget,
): InlineReviewEditorState | null {
  return reviewActions.composerMode === "comment" &&
    isInlineReviewEditorForTarget(reviewActions.editor, reviewTarget)
    ? reviewActions.editor
    : null;
}

function activeSuggestionEditorForTarget(
  reviewActions: InlineReviewActions,
  reviewTarget: ReviewableDiffTarget,
): InlineSuggestionEditorState | null {
  return reviewActions.composerMode === "suggestion" &&
    reviewActions.suggestionEditor?.targets.at(-1)?.key === reviewTarget.key
    ? reviewActions.suggestionEditor
    : null;
}

export function getInlineReviewThreadState(input: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
}) {
  const { reviewTarget, reviewActions } = input;
  if (!reviewTarget || !reviewActions) return null;
  const comments = reviewActions.commentsByTarget.get(reviewTarget.key) ?? [];
  const suggestions = reviewActions.suggestionsByTarget.get(reviewTarget.key) ?? [];
  const forgeThreads = reviewActions.forgeThreadsByTarget?.get(reviewTarget.key) ?? [];
  const editor = activeCommentEditorForTarget(reviewActions, reviewTarget);
  const suggestionEditor = activeSuggestionEditorForTarget(reviewActions, reviewTarget);
  const visibleComments =
    editor?.commentId && comments.some((comment) => comment.id === editor.commentId)
      ? comments.length - 1
      : comments.length;
  const visibleSuggestions =
    suggestionEditor?.suggestionId &&
    suggestions.some((suggestion) => suggestion.id === suggestionEditor.suggestionId)
      ? suggestions.length - 1
      : suggestions.length;
  const blocks =
    visibleComments +
    visibleSuggestions +
    forgeThreads.length +
    Number(Boolean(editor)) +
    Number(Boolean(suggestionEditor));
  if (blocks === 0) return null;
  return {
    comments,
    suggestions,
    hasEditor: Boolean(editor),
    hasSuggestionEditor: Boolean(suggestionEditor),
    editingCommentId: editor?.commentId ?? null,
    editingSuggestionId: suggestionEditor?.suggestionId ?? null,
    height:
      visibleComments * INLINE_REVIEW_COMMENT_HEIGHT +
      visibleSuggestions * INLINE_SUGGESTION_HEIGHT +
      forgeThreads.reduce(
        (height, thread) =>
          height +
          (thread.isResolved
            ? INLINE_RESOLVED_FORGE_DISCUSSION_HEIGHT
            : INLINE_FORGE_DISCUSSION_HEIGHT),
        0,
      ) +
      Number(Boolean(editor)) * INLINE_REVIEW_EDITOR_HEIGHT +
      Number(Boolean(suggestionEditor)) * INLINE_SUGGESTION_EDITOR_HEIGHT +
      Math.max(0, blocks - 1) * INLINE_REVIEW_GAP,
  };
}

export function getSplitInlineReviewThreadState(input: {
  left: ReviewableDiffTarget | null | undefined;
  right: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
}) {
  const left = getInlineReviewThreadState({
    reviewTarget: input.left,
    reviewActions: input.reviewActions,
  });
  const right = getInlineReviewThreadState({
    reviewTarget: input.right,
    reviewActions: input.reviewActions,
  });
  const height = Math.max(left?.height ?? 0, right?.height ?? 0);
  return height === 0 ? null : { left, right, height };
}
