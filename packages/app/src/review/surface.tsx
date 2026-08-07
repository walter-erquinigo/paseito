import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Pencil, Plus, Trash2 } from "lucide-react-native";
import {
  Pressable,
  type PointerEvent as NativePointerEvent,
  type PressableStateCallbackType,
  Text,
  TextInput,
  type TextStyle,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import { getIsElectronMac, isWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useWorkspaceFocusRestoration } from "@/workspace/focus";
import {
  useReviewDraftComments,
  useReviewDraftStore,
  type ReviewDraftComment,
  type ReviewDraftSuggestion,
} from "./store";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  buildSuggestionRange,
  editableSuggestionTargetContent,
  isSuggestibleTarget,
  type SuggestionRangeFailure,
} from "./suggestion-range";

type PressableState = PressableStateCallbackType & { hovered?: boolean };
type WebTextInputRef = TextInput & {
  getNativeElement?: () => unknown;
  getNativeRef?: () => unknown;
};

function iconButtonStyle({ hovered, pressed }: PressableState): StyleProp<ViewStyle> {
  return [styles.iconButton, (hovered || pressed) && styles.iconButtonHovered];
}

function iconButtonDestructiveStyle({ hovered, pressed }: PressableState): StyleProp<ViewStyle> {
  return [styles.iconButton, (hovered || pressed) && styles.iconButtonDestructiveHovered];
}

function getWebTextInputElement(input: TextInput | null): HTMLElement | null {
  if (!isWeb || typeof HTMLElement === "undefined" || !input) {
    return null;
  }
  const webInput = input as WebTextInputRef;
  const element = webInput.getNativeElement?.() ?? webInput.getNativeRef?.() ?? input;
  return element instanceof HTMLElement ? element : null;
}

function getCanShowReviewKeyboardHints(): boolean {
  if (!isWeb || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function useCanShowReviewKeyboardHints(): boolean {
  const [canShowHints, setCanShowHints] = useState(getCanShowReviewKeyboardHints);

  useEffect(() => {
    if (!isWeb || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const handleChange = () => setCanShowHints(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);
    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
    };
  }, []);

  return canShowHints;
}

export const INLINE_REVIEW_COMMENT_HEIGHT = 72;
export const INLINE_REVIEW_EDITOR_HEIGHT = 132;
export const INLINE_SUGGESTION_EDITOR_HEIGHT = 280;
export const INLINE_SUGGESTION_HEIGHT = 112;
const INLINE_REVIEW_GAP = 6;
export const SMALL_ACTION_HIT_SLOP = 8;
const REVIEW_CANCEL_SHORTCUT_KEYS: ShortcutKey[] = ["Esc"];
const REVIEW_SAVE_SHORTCUT_KEYS: ShortcutKey[] = ["mod", "Enter"];
const EMPTY_SUGGESTIONS: ReviewDraftSuggestion[] = [];
const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveIconColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const accentForegroundIconColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});
const ThemedPencil = withUnistyles(Pencil);
const ThemedPlus = withUnistyles(Plus);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedCode2 = withUnistyles(Code2);

export interface InlineReviewEditorState {
  target: ReviewableDiffTarget;
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

interface InlineSuggestionSelectionState {
  kind: "drag" | "shift";
  anchor: ReviewableDiffTarget;
  focus: ReviewableDiffTarget;
  moved: boolean;
}

export interface InlineReviewActions {
  canSuggest: boolean;
  commentsByTarget: ReadonlyMap<string, ReviewDraftComment[]>;
  editor: InlineReviewEditorState | null;
  suggestionsByTarget: ReadonlyMap<string, ReviewDraftSuggestion[]>;
  suggestionEditor: InlineSuggestionEditorState | null;
  selectedSuggestionTargetKeys: ReadonlySet<string>;
  suggestionRangeError: SuggestionRangeFailure | null;
  onStartComment: (target: ReviewableDiffTarget) => void;
  onEditComment: (target: ReviewableDiffTarget, comment: ReviewDraftComment) => void;
  onCancelEditor: () => void;
  onSaveEditor: (body: string) => void;
  onDeleteComment: (id: string) => void;
  onStartSuggestion: (target: ReviewableDiffTarget) => void;
  onBeginSuggestionDrag: (target: ReviewableDiffTarget) => void;
  onUpdateSuggestionDrag: (target: ReviewableDiffTarget) => void;
  onShiftSuggestionRange: (target: ReviewableDiffTarget) => void;
  onPressReviewGutter: (target: ReviewableDiffTarget) => void;
  onCancelSuggestionRange: () => void;
  onClearSuggestionRangeError: () => void;
  onCancelSuggestion: () => void;
  onEditSuggestion: (suggestion: ReviewDraftSuggestion) => void;
  onExtendSuggestion: (direction: "up" | "down") => void;
  onSaveSuggestion: (replacement: string, note: string) => void;
  onDeleteSuggestion: (id: string) => void;
}

export function groupInlineReviewCommentsByTarget(
  comments: readonly ReviewDraftComment[],
): Map<string, ReviewDraftComment[]> {
  const grouped = new Map<string, ReviewDraftComment[]>();
  for (const comment of comments) {
    const key = buildReviewableDiffTargetKey(comment);
    grouped.set(key, [...(grouped.get(key) ?? []), comment]);
  }
  return grouped;
}

function replacementByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function groupSuggestionsByTarget(
  suggestions: readonly ReviewDraftSuggestion[],
): Map<string, ReviewDraftSuggestion[]> {
  const grouped = new Map<string, ReviewDraftSuggestion[]>();
  for (const suggestion of suggestions) {
    const key = buildReviewableDiffTargetKey({
      filePath: suggestion.filePath,
      side: "new",
      lineNumber: suggestion.endLine,
    });
    grouped.set(key, [...(grouped.get(key) ?? []), suggestion]);
  }
  return grouped;
}

export function useInlineReviewController(input: {
  reviewDraftKey: string;
  availableTargets?: readonly ReviewableDiffTarget[];
  suggestionsSupported?: boolean;
}): InlineReviewActions {
  const reviewComments = useReviewDraftComments(input.reviewDraftKey);
  const commentsByTarget = useMemo(
    () => groupInlineReviewCommentsByTarget(reviewComments),
    [reviewComments],
  );
  const [editor, setEditor] = useState<InlineReviewEditorState | null>(null);
  const suggestions = useReviewDraftStore(
    (state) => state.suggestions[input.reviewDraftKey] ?? EMPTY_SUGGESTIONS,
  );
  const suggestionsByTarget = useMemo(() => groupSuggestionsByTarget(suggestions), [suggestions]);
  const [suggestionEditor, setSuggestionEditor] = useState<InlineSuggestionEditorState | null>(
    null,
  );
  const [suggestionSelection, setSuggestionSelectionState] =
    useState<InlineSuggestionSelectionState | null>(null);
  const suggestionSelectionRef = useRef<InlineSuggestionSelectionState | null>(null);
  const availableTargetsRef = useRef(input.availableTargets ?? []);
  availableTargetsRef.current = input.availableTargets ?? [];
  const suppressNextGutterPressRef = useRef(false);
  const [suggestionRangeError, setSuggestionRangeError] = useState<SuggestionRangeFailure | null>(
    null,
  );
  const addComment = useReviewDraftStore((state) => state.addComment);
  const updateComment = useReviewDraftStore((state) => state.updateComment);
  const deleteComment = useReviewDraftStore((state) => state.deleteComment);
  const addSuggestion = useReviewDraftStore((state) => state.addSuggestion);
  const updateSuggestion = useReviewDraftStore((state) => state.updateSuggestion);
  const deleteSuggestion = useReviewDraftStore((state) => state.deleteSuggestion);

  useEffect(() => {
    setEditor(null);
    setSuggestionEditor(null);
    suggestionSelectionRef.current = null;
    setSuggestionSelectionState(null);
    setSuggestionRangeError(null);
  }, [input.reviewDraftKey]);

  const setSuggestionSelection = useCallback(
    (
      next:
        | InlineSuggestionSelectionState
        | null
        | ((
            current: InlineSuggestionSelectionState | null,
          ) => InlineSuggestionSelectionState | null),
    ) => {
      const resolved = typeof next === "function" ? next(suggestionSelectionRef.current) : next;
      suggestionSelectionRef.current = resolved;
      setSuggestionSelectionState(resolved);
    },
    [],
  );

  const suppressNextGutterPress = useCallback(() => {
    suppressNextGutterPressRef.current = true;
    setTimeout(() => {
      suppressNextGutterPressRef.current = false;
    }, 0);
  }, []);

  const openSuggestionEditor = useCallback(
    (targets: ReviewableDiffTarget[]) => {
      const first = targets[0];
      if (!first?.sourceRevision) return;
      setEditor(null);
      setSuggestionEditor({
        targets,
        suggestionId: null,
        replacement: targets.map(editableSuggestionTargetContent).join("\n"),
        note: "",
        sourceRevision: first.sourceRevision,
      });
      setSuggestionSelection(null);
    },
    [setSuggestionSelection],
  );

  const completeSuggestionRange = useCallback(
    (selection: InlineSuggestionSelectionState): boolean => {
      const result = buildSuggestionRange({
        anchor: selection.anchor,
        focus: selection.focus,
        availableTargets: availableTargetsRef.current,
      });
      if (!result.ok) {
        setSuggestionRangeError(result.reason);
        setSuggestionSelection(null);
        return false;
      }
      openSuggestionEditor(result.targets);
      return true;
    },
    [openSuggestionEditor, setSuggestionSelection],
  );

  const handleStartComment = useCallback(
    (target: ReviewableDiffTarget) => {
      setSuggestionEditor(null);
      setSuggestionSelection(null);
      setEditor({ target, commentId: null, body: "" });
    },
    [setSuggestionSelection],
  );

  const handleEditComment = useCallback(
    (target: ReviewableDiffTarget, comment: ReviewDraftComment) => {
      setEditor({ target, commentId: comment.id, body: comment.body });
    },
    [],
  );

  const handleCancelEditor = useCallback(() => {
    setEditor(null);
  }, []);

  const handleSaveEditor = useCallback(
    (body: string) => {
      const trimmedBody = body.trim();
      if (!editor || trimmedBody.length === 0) {
        return;
      }

      if (editor.commentId) {
        updateComment({
          key: input.reviewDraftKey,
          id: editor.commentId,
          updates: { body: trimmedBody },
        });
      } else {
        addComment({
          key: input.reviewDraftKey,
          comment: {
            filePath: editor.target.filePath,
            side: editor.target.side,
            lineNumber: editor.target.lineNumber,
            body: trimmedBody,
          },
        });
      }
      setEditor(null);
    },
    [addComment, editor, input.reviewDraftKey, updateComment],
  );

  const handleDeleteComment = useCallback(
    (id: string) => {
      deleteComment({ key: input.reviewDraftKey, id });
      setEditor((current) => (current?.commentId === id ? null : current));
    },
    [deleteComment, input.reviewDraftKey],
  );

  const handleStartSuggestion = useCallback(
    (target: ReviewableDiffTarget) => {
      if (!input.suggestionsSupported || !isSuggestibleTarget(target)) return;
      openSuggestionEditor([target]);
    },
    [input.suggestionsSupported, openSuggestionEditor],
  );

  const handleBeginSuggestionDrag = useCallback(
    (target: ReviewableDiffTarget) => {
      if (!input.suggestionsSupported || !isSuggestibleTarget(target)) return;
      setSuggestionRangeError(null);
      setEditor(null);
      setSuggestionEditor(null);
      setSuggestionSelection({ kind: "drag", anchor: target, focus: target, moved: false });
    },
    [input.suggestionsSupported, setSuggestionSelection],
  );

  const handleUpdateSuggestionDrag = useCallback(
    (target: ReviewableDiffTarget) => {
      setSuggestionSelection((current) => {
        if (!current || current.kind !== "drag" || !isSuggestibleTarget(target)) return current;
        if (
          target.filePath !== current.anchor.filePath ||
          target.sourceRevision !== current.anchor.sourceRevision
        ) {
          return current;
        }
        return {
          ...current,
          focus: target,
          moved: current.moved || target.lineNumber !== current.anchor.lineNumber,
        };
      });
    },
    [setSuggestionSelection],
  );

  const handleShiftSuggestionRange = useCallback(
    (target: ReviewableDiffTarget) => {
      if (!input.suggestionsSupported || !isSuggestibleTarget(target)) return;
      suppressNextGutterPress();
      const current = suggestionSelectionRef.current;
      if (current?.kind === "shift") {
        completeSuggestionRange({ ...current, focus: target, moved: true });
        return;
      }
      setSuggestionRangeError(null);
      setEditor(null);
      setSuggestionEditor(null);
      setSuggestionSelection({ kind: "shift", anchor: target, focus: target, moved: false });
    },
    [
      completeSuggestionRange,
      input.suggestionsSupported,
      setSuggestionSelection,
      suppressNextGutterPress,
    ],
  );

  const handlePressReviewGutter = useCallback(
    (target: ReviewableDiffTarget) => {
      if (suppressNextGutterPressRef.current) {
        suppressNextGutterPressRef.current = false;
        return;
      }
      handleStartComment(target);
    },
    [handleStartComment],
  );

  const handleCancelSuggestionRange = useCallback(() => {
    setSuggestionSelection(null);
  }, [setSuggestionSelection]);

  const handleClearSuggestionRangeError = useCallback(() => setSuggestionRangeError(null), []);

  useEffect(() => {
    if (!isWeb || typeof window === "undefined" || suggestionSelection?.kind !== "drag") return;
    const handlePointerUp = () => {
      const current = suggestionSelectionRef.current;
      if (!current || current.kind !== "drag") return;
      setSuggestionSelection(null);
      if (current.moved) {
        suppressNextGutterPress();
        completeSuggestionRange(current);
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [
    completeSuggestionRange,
    setSuggestionSelection,
    suggestionSelection?.kind,
    suppressNextGutterPress,
  ]);

  useEffect(() => {
    if (!isWeb || typeof window === "undefined" || !suggestionSelection) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSuggestionSelection(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (suggestionSelection.kind !== "shift") return;
      const element = event.target instanceof Element ? event.target : null;
      if (!element?.closest("[data-paseito-suggestion-gutter]")) {
        setSuggestionSelection(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [setSuggestionSelection, suggestionSelection]);

  const handleEditSuggestion = useCallback(
    (suggestion: ReviewDraftSuggestion) => {
      const anchor = (input.availableTargets ?? []).find(
        (target) =>
          target.filePath === suggestion.filePath &&
          target.side === "new" &&
          target.lineNumber === suggestion.startLine,
      );
      const focus = (input.availableTargets ?? []).find(
        (target) =>
          target.filePath === suggestion.filePath &&
          target.side === "new" &&
          target.lineNumber === suggestion.endLine,
      );
      if (!anchor || !focus) return;
      const result = buildSuggestionRange({
        anchor,
        focus,
        availableTargets: input.availableTargets ?? [],
      });
      if (!result.ok || result.targets.length !== suggestion.originalLines.length) return;
      setEditor(null);
      setSuggestionEditor({
        targets: result.targets,
        suggestionId: suggestion.id,
        replacement: suggestion.replacement,
        note: suggestion.note,
        sourceRevision: suggestion.sourceRevision,
      });
    },
    [input.availableTargets],
  );

  const handleExtendSuggestion = useCallback(
    (direction: "up" | "down") => {
      setSuggestionEditor((current) => {
        if (!current || current.targets.length >= 200 || current.suggestionId) return current;
        const edge = direction === "up" ? current.targets[0] : current.targets.at(-1);
        if (!edge) return current;
        const candidate = (input.availableTargets ?? []).find(
          (target) =>
            target.filePath === edge.filePath &&
            target.side === "new" &&
            target.lineNumber === edge.lineNumber + (direction === "up" ? -1 : 1) &&
            isSuggestibleTarget(target),
        );
        if (!candidate) return current;
        const targets =
          direction === "up" ? [candidate, ...current.targets] : [...current.targets, candidate];
        return {
          ...current,
          targets,
          replacement: targets.map(editableSuggestionTargetContent).join("\n"),
        };
      });
    },
    [input.availableTargets],
  );

  const handleSaveSuggestion = useCallback(
    (replacement: string, note: string) => {
      if (!suggestionEditor) return;
      const originalLines = suggestionEditor.targets.map(editableSuggestionTargetContent);
      const currentRevision = suggestionEditor.targets[0]?.sourceRevision;
      const isStale = Boolean(
        currentRevision && currentRevision !== suggestionEditor.sourceRevision,
      );
      if (
        (!isStale && replacement === originalLines.join("\n")) ||
        replacementByteLength(replacement) > 65_536
      )
        return;
      if (suggestionEditor.suggestionId) {
        const first = suggestionEditor.targets[0];
        if (!first?.sourceRevision) return;
        updateSuggestion({
          key: input.reviewDraftKey,
          id: suggestionEditor.suggestionId,
          updates: {
            replacement,
            note,
            originalLines,
            sourceRevision: first.sourceRevision,
          },
        });
      } else {
        const first = suggestionEditor.targets[0];
        const last = suggestionEditor.targets.at(-1);
        if (!first || !last || !first.sourceRevision) return;
        addSuggestion({
          key: input.reviewDraftKey,
          suggestion: {
            filePath: first.filePath,
            startLine: first.lineNumber,
            endLine: last.lineNumber,
            originalLines,
            replacement,
            note: note.trim(),
            sourceRevision: first.sourceRevision,
          },
        });
      }
      setSuggestionEditor(null);
    },
    [addSuggestion, input.reviewDraftKey, suggestionEditor, updateSuggestion],
  );

  const handleDeleteSuggestion = useCallback(
    (id: string) => {
      deleteSuggestion({ key: input.reviewDraftKey, id });
      setSuggestionEditor((current) => (current?.suggestionId === id ? null : current));
    },
    [deleteSuggestion, input.reviewDraftKey],
  );
  const handleCancelSuggestion = useCallback(() => {
    setSuggestionEditor(null);
    setSuggestionSelection(null);
  }, [setSuggestionSelection]);

  useEffect(() => {
    const current = suggestionSelectionRef.current;
    if (!current) return;
    const availableKeys = new Set((input.availableTargets ?? []).map((target) => target.key));
    if (!availableKeys.has(current.anchor.key) || !availableKeys.has(current.focus.key)) {
      setSuggestionSelection(null);
    }
  }, [input.availableTargets, setSuggestionSelection]);

  const selectedSuggestionTargetKeys = useMemo<ReadonlySet<string>>(() => {
    if (suggestionEditor) {
      return new Set(suggestionEditor.targets.map((target) => target.key));
    }
    if (!suggestionSelection) return new Set();
    const result = buildSuggestionRange({
      anchor: suggestionSelection.anchor,
      focus: suggestionSelection.focus,
      availableTargets: input.availableTargets ?? [],
    });
    if (result.ok) return new Set(result.targets.map((target) => target.key));
    return new Set([suggestionSelection.anchor.key, suggestionSelection.focus.key]);
  }, [input.availableTargets, suggestionEditor, suggestionSelection]);

  return useMemo<InlineReviewActions>(
    () => ({
      commentsByTarget,
      canSuggest: input.suggestionsSupported === true,
      editor,
      suggestionsByTarget,
      suggestionEditor,
      selectedSuggestionTargetKeys,
      suggestionRangeError,
      onStartComment: handleStartComment,
      onEditComment: handleEditComment,
      onCancelEditor: handleCancelEditor,
      onSaveEditor: handleSaveEditor,
      onDeleteComment: handleDeleteComment,
      onStartSuggestion: handleStartSuggestion,
      onBeginSuggestionDrag: handleBeginSuggestionDrag,
      onUpdateSuggestionDrag: handleUpdateSuggestionDrag,
      onShiftSuggestionRange: handleShiftSuggestionRange,
      onPressReviewGutter: handlePressReviewGutter,
      onCancelSuggestionRange: handleCancelSuggestionRange,
      onClearSuggestionRangeError: handleClearSuggestionRangeError,
      onCancelSuggestion: handleCancelSuggestion,
      onEditSuggestion: handleEditSuggestion,
      onExtendSuggestion: handleExtendSuggestion,
      onSaveSuggestion: handleSaveSuggestion,
      onDeleteSuggestion: handleDeleteSuggestion,
    }),
    [
      commentsByTarget,
      input.suggestionsSupported,
      editor,
      suggestionsByTarget,
      suggestionEditor,
      selectedSuggestionTargetKeys,
      suggestionRangeError,
      handleCancelEditor,
      handleDeleteComment,
      handleEditComment,
      handleSaveEditor,
      handleStartComment,
      handleStartSuggestion,
      handleBeginSuggestionDrag,
      handleUpdateSuggestionDrag,
      handleShiftSuggestionRange,
      handlePressReviewGutter,
      handleCancelSuggestionRange,
      handleClearSuggestionRangeError,
      handleCancelSuggestion,
      handleEditSuggestion,
      handleExtendSuggestion,
      handleSaveSuggestion,
      handleDeleteSuggestion,
    ],
  );
}

export function isInlineReviewEditorForTarget(
  editor: InlineReviewEditorState | null,
  target: ReviewableDiffTarget | null | undefined,
): boolean {
  return Boolean(
    editor &&
    target &&
    buildReviewableDiffTargetKey(editor.target) === buildReviewableDiffTargetKey(target),
  );
}

export function getInlineReviewThreadState(input: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
}): {
  comments: ReviewDraftComment[];
  suggestions: ReviewDraftSuggestion[];
  hasEditor: boolean;
  hasSuggestionEditor: boolean;
  editingCommentId: string | null;
  editingSuggestionId: string | null;
  height: number;
} | null {
  const { reviewTarget, reviewActions } = input;
  if (!reviewTarget || !reviewActions) {
    return null;
  }

  const comments = reviewActions.commentsByTarget.get(reviewTarget.key) ?? [];
  const suggestions = reviewActions.suggestionsByTarget.get(reviewTarget.key) ?? [];
  const editorForTarget = isInlineReviewEditorForTarget(reviewActions.editor, reviewTarget)
    ? reviewActions.editor
    : null;
  const hasEditor = editorForTarget !== null;
  const editingCommentId = editorForTarget?.commentId ?? null;
  const editingExisting =
    editingCommentId !== null && comments.some((comment) => comment.id === editingCommentId);

  const suggestionEditorForTarget =
    reviewActions.suggestionEditor?.targets.at(-1)?.key === reviewTarget.key
      ? reviewActions.suggestionEditor
      : null;
  const hasSuggestionEditor = suggestionEditorForTarget !== null;
  const editingSuggestionId = suggestionEditorForTarget?.suggestionId ?? null;
  const editingExistingSuggestion =
    editingSuggestionId !== null &&
    suggestions.some((suggestion) => suggestion.id === editingSuggestionId);

  const visibleCommentCount = editingExisting ? comments.length - 1 : comments.length;
  const visibleSuggestionCount = editingExistingSuggestion
    ? suggestions.length - 1
    : suggestions.length;
  const editorCount = hasEditor ? 1 : 0;
  const suggestionEditorCount = hasSuggestionEditor ? 1 : 0;
  const visibleBlockCount =
    visibleCommentCount + visibleSuggestionCount + editorCount + suggestionEditorCount;
  if (visibleBlockCount === 0) {
    return null;
  }

  const height =
    visibleCommentCount * INLINE_REVIEW_COMMENT_HEIGHT +
    visibleSuggestionCount * INLINE_SUGGESTION_HEIGHT +
    editorCount * INLINE_REVIEW_EDITOR_HEIGHT +
    suggestionEditorCount * INLINE_SUGGESTION_EDITOR_HEIGHT +
    Math.max(0, visibleBlockCount - 1) * INLINE_REVIEW_GAP;

  return {
    comments,
    suggestions,
    hasEditor,
    hasSuggestionEditor,
    editingCommentId,
    editingSuggestionId,
    height,
  };
}

export function getSplitInlineReviewThreadState(input: {
  left: ReviewableDiffTarget | null | undefined;
  right: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
}): {
  left: ReturnType<typeof getInlineReviewThreadState>;
  right: ReturnType<typeof getInlineReviewThreadState>;
  height: number;
} | null {
  const left = getInlineReviewThreadState({
    reviewTarget: input.left,
    reviewActions: input.reviewActions,
  });
  const right = getInlineReviewThreadState({
    reviewTarget: input.right,
    reviewActions: input.reviewActions,
  });
  const height = Math.max(left?.height ?? 0, right?.height ?? 0);
  if (height === 0) {
    return null;
  }
  return { left, right, height };
}

export function InlineReviewGutterCell({
  children,
  reviewTarget,
  comments,
  isLineHovered = false,
  lineHeight,
  onStartComment,
  reviewActions,
  style,
  actionTestID,
}: {
  children: ReactNode;
  reviewTarget: ReviewableDiffTarget | null | undefined;
  comments: readonly ReviewDraftComment[];
  isEditorOpen: boolean;
  isLineHovered?: boolean;
  lineHeight?: number;
  onStartComment: (target: ReviewableDiffTarget) => void;
  reviewActions?: InlineReviewActions;
  style?: StyleProp<ViewStyle>;
  actionTestID?: string;
}) {
  const { t } = useTranslation();
  const canComment = Boolean(reviewTarget);
  const hasComments = comments.length > 0;
  const [isGutterHovered, setIsGutterHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isDismissedAfterPress, setIsDismissedAfterPress] = useState(false);
  const isInteractionActive = isGutterHovered || isLineHovered || isPressed;
  const showAction = canComment && isInteractionActive && !isDismissedAfterPress;
  const canSelectSuggestionRange = Boolean(
    reviewTarget &&
    reviewActions?.canSuggest &&
    isSuggestibleTarget(reviewTarget) &&
    getIsElectronMac(),
  );

  const handlePress = useCallback(() => {
    if (reviewTarget) {
      setIsDismissedAfterPress(true);
      if (canSelectSuggestionRange && reviewActions) {
        reviewActions.onPressReviewGutter(reviewTarget);
      } else {
        onStartComment(reviewTarget);
      }
    }
  }, [canSelectSuggestionRange, onStartComment, reviewActions, reviewTarget]);

  const handlePointerDown = useCallback(
    (event: NativePointerEvent) => {
      if (
        !canSelectSuggestionRange ||
        !reviewTarget ||
        !reviewActions ||
        event.nativeEvent.button !== 0
      )
        return;
      if (event.nativeEvent.shiftKey) {
        reviewActions.onShiftSuggestionRange(reviewTarget);
      } else {
        reviewActions.onBeginSuggestionDrag(reviewTarget);
      }
    },
    [canSelectSuggestionRange, reviewActions, reviewTarget],
  );

  const handlePointerEnter = useCallback(
    (event: NativePointerEvent) => {
      if (
        canSelectSuggestionRange &&
        reviewTarget &&
        reviewActions &&
        (event.nativeEvent.buttons & 1) === 1
      ) {
        reviewActions.onUpdateSuggestionDrag(reviewTarget);
      }
    },
    [canSelectSuggestionRange, reviewActions, reviewTarget],
  );

  const desktopRangeProps = canSelectSuggestionRange
    ? {
        dataSet: { paseitoSuggestionGutter: "true" },
        onPointerDown: handlePointerDown,
        onPointerEnter: handlePointerEnter,
      }
    : {};

  const handleHoverIn = useCallback(() => {
    setIsGutterHovered(true);
  }, []);

  const handleHoverOut = useCallback(() => {
    setIsGutterHovered(false);
  }, []);

  const handlePressIn = useCallback(() => {
    setIsPressed(true);
  }, []);

  const handlePressOut = useCallback(() => {
    setIsPressed(false);
  }, []);

  useEffect(() => {
    if (!isInteractionActive) {
      setIsDismissedAfterPress(false);
    }
  }, [isInteractionActive]);

  const pressableStyle = useCallback((): StyleProp<ViewStyle> => style, [style]);
  const lineHeightStyle = useMemo<StyleProp<ViewStyle>>(
    () =>
      lineHeight !== undefined
        ? inlineUnistylesStyle({ height: lineHeight, minHeight: lineHeight })
        : null,
    [lineHeight],
  );

  const labelStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.gutterLabel, lineHeightStyle, hasComments && styles.gutterLabelActive],
    [hasComments, lineHeightStyle],
  );
  const innerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.gutterInner, lineHeightStyle],
    [lineHeightStyle],
  );
  const actionIconStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.gutterActionIcon,
      lineHeight !== undefined && inlineUnistylesStyle({ top: Math.floor((lineHeight - 22) / 2) }),
    ],
    [lineHeight],
  );

  return (
    <Pressable
      {...desktopRangeProps}
      accessibilityRole={canComment ? "button" : undefined}
      accessibilityLabel={canComment ? t("review.comment.add") : undefined}
      hitSlop={canComment ? SMALL_ACTION_HIT_SLOP : undefined}
      disabled={!canComment}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={pressableStyle}
    >
      <View style={innerStyle}>
        <View style={labelStyle}>
          {children}
          {showAction ? (
            <View style={actionIconStyle} testID={actionTestID}>
              <ThemedPlus size={16} strokeWidth={2.4} uniProps={accentForegroundIconColorMapping} />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function InlineReviewThread({
  reviewTarget,
  reviewActions,
  height,
  viewportWidth,
  pinToViewport = false,
  testID,
}: {
  reviewTarget: ReviewableDiffTarget;
  reviewActions: InlineReviewActions;
  height: number;
  viewportWidth?: number;
  pinToViewport?: boolean;
  testID?: string;
}) {
  const comments = reviewActions.commentsByTarget.get(reviewTarget.key) ?? [];
  const suggestions = reviewActions.suggestionsByTarget.get(reviewTarget.key) ?? [];
  const editor = isInlineReviewEditorForTarget(reviewActions.editor, reviewTarget)
    ? reviewActions.editor
    : null;
  const handleSuggestEdit = useCallback(
    () => reviewActions.onStartSuggestion(reviewTarget),
    [reviewActions, reviewTarget],
  );
  const canStartSuggestion =
    reviewActions.canSuggest && editor?.commentId === null && isSuggestibleTarget(reviewTarget);
  const suggestionEditor =
    reviewActions.suggestionEditor?.targets.at(-1)?.key === reviewTarget.key
      ? reviewActions.suggestionEditor
      : null;
  const containerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.threadContainer,
      getInlineReviewThreadViewportStyle({ viewportWidth, pinToViewport }),
      inlineUnistylesStyle({ minHeight: height }),
    ],
    [viewportWidth, pinToViewport, height],
  );

  return (
    <View style={containerStyle} testID={testID}>
      <InlineCommentBlocks
        comments={comments}
        editor={editor}
        onSuggestEdit={canStartSuggestion ? handleSuggestEdit : undefined}
        reviewTarget={reviewTarget}
        reviewActions={reviewActions}
      />
      <InlineSuggestionBlocks
        suggestions={suggestions}
        editor={suggestionEditor}
        reviewTarget={reviewTarget}
        reviewActions={reviewActions}
      />
    </View>
  );
}

function InlineCommentBlocks({
  comments,
  editor,
  onSuggestEdit,
  reviewTarget,
  reviewActions,
}: {
  comments: ReviewDraftComment[];
  editor: InlineReviewEditorState | null;
  onSuggestEdit?: () => void;
  reviewTarget: ReviewableDiffTarget;
  reviewActions: InlineReviewActions;
}) {
  const editingCommentId = editor?.commentId ?? null;
  const editingExisting = comments.some((comment) => comment.id === editingCommentId);
  const editorElement = editor ? (
    <InlineReviewEditor
      key={editingCommentId ?? "new"}
      initialBody={editor.body}
      onCancel={reviewActions.onCancelEditor}
      onSave={reviewActions.onSaveEditor}
      onSuggestEdit={onSuggestEdit}
      testID="inline-review-editor"
    />
  ) : null;
  const blocks = comments.map((comment) => {
    if (comment.id === editingCommentId) {
      return <React.Fragment key={comment.id}>{editorElement}</React.Fragment>;
    }
    return (
      <CommentRow
        key={comment.id}
        comment={comment}
        reviewTarget={reviewTarget}
        onEditComment={reviewActions.onEditComment}
        onDeleteComment={reviewActions.onDeleteComment}
      />
    );
  });
  if (editorElement && !editingExisting) blocks.push(editorElement);
  return blocks;
}

function InlineSuggestionBlocks({
  suggestions,
  editor,
  reviewTarget,
  reviewActions,
}: {
  suggestions: ReviewDraftSuggestion[];
  editor: InlineSuggestionEditorState | null;
  reviewTarget: ReviewableDiffTarget;
  reviewActions: InlineReviewActions;
}) {
  const editingSuggestionId = editor?.suggestionId ?? null;
  const editingExisting = suggestions.some((suggestion) => suggestion.id === editingSuggestionId);
  const editorElement = editor ? (
    <InlineSuggestionEditor
      key={`${editor.suggestionId ?? "new-suggestion"}:${editor.targets[0]?.lineNumber}:${editor.targets.at(-1)?.lineNumber}:${editor.sourceRevision}`}
      editor={editor}
      onCancel={reviewActions.onCancelSuggestion}
      onExtend={reviewActions.onExtendSuggestion}
      onSave={reviewActions.onSaveSuggestion}
    />
  ) : null;
  const blocks = suggestions.map((suggestion) => {
    if (suggestion.id === editingSuggestionId) {
      return <React.Fragment key={suggestion.id}>{editorElement}</React.Fragment>;
    }
    return (
      <SuggestionRow
        key={suggestion.id}
        suggestion={suggestion}
        stale={suggestion.sourceRevision !== reviewTarget.sourceRevision}
        onEdit={reviewActions.onEditSuggestion}
        onDelete={reviewActions.onDeleteSuggestion}
      />
    );
  });
  if (editorElement && !editingExisting) blocks.push(editorElement);
  return blocks;
}

function CommentRow({
  comment,
  reviewTarget,
  onEditComment,
  onDeleteComment,
}: {
  comment: ReviewDraftComment;
  reviewTarget: ReviewableDiffTarget;
  onEditComment: (target: ReviewableDiffTarget, comment: ReviewDraftComment) => void;
  onDeleteComment: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleEdit = useCallback(
    () => onEditComment(reviewTarget, comment),
    [onEditComment, reviewTarget, comment],
  );

  const handleDelete = useCallback(
    () => onDeleteComment(comment.id),
    [onDeleteComment, comment.id],
  );

  return (
    <View style={styles.commentBlock}>
      <Text style={styles.commentBody} numberOfLines={2}>
        {comment.body}
      </Text>
      <View style={styles.commentActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("review.comment.edit")}
          testID={`review-comment-edit-${comment.id}`}
          hitSlop={SMALL_ACTION_HIT_SLOP}
          onPress={handleEdit}
          style={iconButtonStyle}
        >
          <ThemedPencil size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("review.comment.delete")}
          testID={`review-comment-delete-${comment.id}`}
          hitSlop={SMALL_ACTION_HIT_SLOP}
          onPress={handleDelete}
          style={iconButtonDestructiveStyle}
        >
          <ThemedTrash2 size={14} uniProps={destructiveIconColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

function SuggestionRow({
  suggestion,
  stale,
  onEdit,
  onDelete,
}: {
  suggestion: ReviewDraftSuggestion;
  stale: boolean;
  onEdit: (suggestion: ReviewDraftSuggestion) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(suggestion), [onEdit, suggestion]);
  const handleDelete = useCallback(() => onDelete(suggestion.id), [onDelete, suggestion.id]);
  return (
    <View style={[styles.commentBlock, styles.suggestionBlock]}>
      <View style={styles.suggestionBody}>
        <Text style={styles.suggestionLabel}>
          {stale
            ? t("review.suggestion.stale")
            : t("review.suggestion.lines", {
                start: suggestion.startLine,
                end: suggestion.endLine,
              })}
        </Text>
        <Text style={styles.suggestionCode} numberOfLines={2}>
          {suggestion.replacement || t("review.suggestion.deleteLines")}
        </Text>
      </View>
      <View style={styles.commentActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("review.suggestion.edit")}
          onPress={handleEdit}
          style={iconButtonStyle}
        >
          <ThemedPencil size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("review.suggestion.delete")}
          onPress={handleDelete}
          style={iconButtonDestructiveStyle}
        >
          <ThemedTrash2 size={14} uniProps={destructiveIconColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

function InlineSuggestionEditor({
  editor,
  onCancel,
  onExtend,
  onSave,
}: {
  editor: InlineSuggestionEditorState;
  onCancel: () => void;
  onExtend: (direction: "up" | "down") => void;
  onSave: (replacement: string, note: string) => void;
}) {
  const { t } = useTranslation();
  const original = editor.targets.map(editableSuggestionTargetContent).join("\n");
  const [replacement, setReplacement] = useState(editor.replacement);
  const [note, setNote] = useState(editor.note);
  const isStale = editor.targets[0]?.sourceRevision !== editor.sourceRevision;
  const canSave =
    (isStale || replacement !== original) && replacementByteLength(replacement) <= 65_536;
  const extendUp = useCallback(() => onExtend("up"), [onExtend]);
  const extendDown = useCallback(() => onExtend("down"), [onExtend]);
  const handleSave = useCallback(() => onSave(replacement, note), [note, onSave, replacement]);
  return (
    <View style={styles.suggestionEditorBlock} testID="inline-suggestion-editor">
      <View style={styles.suggestionEditorHeader}>
        <ThemedCode2 size={14} uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.suggestionLabel}>
          {t("review.suggestion.lines", {
            start: editor.targets[0]?.lineNumber,
            end: editor.targets.at(-1)?.lineNumber,
          })}
        </Text>
      </View>
      {!editor.suggestionId ? (
        <View style={styles.suggestionRangeActions}>
          <Button size="xs" variant="ghost" onPress={extendUp}>
            {t("review.suggestion.addLineAbove")}
          </Button>
          <Button size="xs" variant="ghost" onPress={extendDown}>
            {t("review.suggestion.addLineBelow")}
          </Button>
        </View>
      ) : null}
      <TextInput
        accessibilityLabel={t("review.suggestion.replacement")}
        multiline
        value={replacement}
        onChangeText={setReplacement}
        style={[styles.editorInput, styles.suggestionReplacementInput]}
      />
      <TextInput
        accessibilityLabel={t("review.suggestion.note")}
        placeholder={t("review.suggestion.notePlaceholder")}
        placeholderTextColor={styles.placeholderColor.color}
        value={note}
        onChangeText={setNote}
        style={[styles.editorInput, styles.suggestionNoteInput]}
      />
      <View style={styles.editorActions}>
        <Button size="xs" variant="ghost" onPress={onCancel}>
          {t("review.comment.cancel")}
        </Button>
        <Button size="xs" disabled={!canSave} onPress={handleSave}>
          {t("review.suggestion.save")}
        </Button>
      </View>
    </View>
  );
}

export function getInlineReviewThreadViewportStyle({
  viewportWidth,
  pinToViewport,
}: {
  viewportWidth?: number;
  pinToViewport: boolean;
}): StyleProp<ViewStyle> {
  const widthStyle =
    viewportWidth && viewportWidth > 0 ? inlineUnistylesStyle({ width: viewportWidth }) : null;
  if (!pinToViewport || !isWeb) {
    return widthStyle;
  }
  const stickyStyle = { position: "sticky", left: 0 } as unknown as ViewStyle;
  return [stickyStyle, widthStyle];
}

export function InlineReviewEditor({
  initialBody,
  onCancel,
  onSave,
  onSuggestEdit,
  testID,
}: {
  initialBody: string;
  onCancel: () => void;
  onSave: (body: string) => void;
  onSuggestEdit?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput | null>(null);
  const focus = useWorkspaceFocusRestoration();
  const canShowKeyboardHints = useCanShowReviewKeyboardHints();
  const [body, setBody] = useState(initialBody);
  const [isFocused, setIsFocused] = useState(false);
  const trimmedBody = body.trim();
  const canSave = trimmedBody.length > 0;
  const showKeyboardHints = isFocused && canShowKeyboardHints;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleFocus = useCallback(() => {
    focus.unfocus();
    setIsFocused(true);
  }, [focus]);
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    focus.restore();
  }, [focus]);
  const handleSave = useCallback(() => onSave(trimmedBody), [onSave, trimmedBody]);
  const cancelShortcut = useMemo(
    () => (showKeyboardHints ? <Shortcut keys={REVIEW_CANCEL_SHORTCUT_KEYS} /> : null),
    [showKeyboardHints],
  );
  const saveShortcut = useMemo(
    () => (showKeyboardHints ? <Shortcut keys={REVIEW_SAVE_SHORTCUT_KEYS} /> : null),
    [showKeyboardHints],
  );

  useEffect(() => {
    const element = getWebTextInputElement(inputRef.current);
    if (!element) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }

      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!canSave) {
        return;
      }
      handleSave();
    };

    element.addEventListener("keydown", handleKeyDown);
    return () => {
      element.removeEventListener("keydown", handleKeyDown);
    };
  }, [canSave, handleSave, onCancel]);

  const inputStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.editorInput, isFocused && styles.editorInputFocused],
    [isFocused],
  );

  return (
    <View style={styles.editorBlock} testID={testID}>
      <TextInput
        ref={inputRef}
        accessibilityLabel={t("review.comment.label")}
        testID={testID ? `${testID}-input` : undefined}
        placeholder={t("review.comment.placeholder")}
        placeholderTextColor={styles.placeholderColor.color}
        multiline
        value={body}
        onChangeText={setBody}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={inputStyle}
      />
      <View style={styles.editorActions}>
        {onSuggestEdit ? (
          <Button
            accessibilityLabel={t("review.suggestion.start")}
            onPress={onSuggestEdit}
            variant="ghost"
            size="xs"
          >
            {t("review.suggestion.start")}
          </Button>
        ) : null}
        <Button
          accessibilityLabel={t("review.comment.cancelAccessibility")}
          testID={testID ? `${testID}-cancel` : undefined}
          hitSlop={SMALL_ACTION_HIT_SLOP}
          onPress={onCancel}
          variant="ghost"
          size="xs"
          trailing={cancelShortcut}
        >
          {t("review.comment.cancel")}
        </Button>
        <Button
          accessibilityLabel={t("review.comment.saveAccessibility")}
          testID={testID ? `${testID}-save` : undefined}
          hitSlop={SMALL_ACTION_HIT_SLOP}
          disabled={!canSave}
          onPress={handleSave}
          variant="default"
          size="xs"
          trailing={saveShortcut}
        >
          {t("review.comment.save")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  gutterInner: {
    minHeight: theme.lineHeight.diff,
    alignItems: "stretch",
    justifyContent: "flex-start",
    overflow: "visible",
  },
  gutterLabel: {
    width: "100%",
    minWidth: 0,
    height: theme.lineHeight.diff,
    alignItems: "stretch",
    justifyContent: "flex-start",
    position: "relative",
    overflow: "visible",
  },
  gutterLabelActive: {
    backgroundColor: theme.colors.surface2,
  },
  gutterActionIcon: {
    position: "absolute",
    right: -10,
    top: Math.floor((theme.lineHeight.diff - 22) / 2),
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    elevation: 10,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  threadContainer: {
    flex: 1,
    minWidth: 0,
    gap: INLINE_REVIEW_GAP,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  commentBlock: {
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  suggestionBlock: {
    minHeight: INLINE_SUGGESTION_HEIGHT,
    borderColor: theme.colors.accent,
  },
  suggestionBody: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  suggestionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  suggestionCode: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  suggestionEditorBlock: {
    minHeight: INLINE_SUGGESTION_EDITOR_HEIGHT,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.accent,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[2],
    gap: theme.spacing[2],
  },
  suggestionEditorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  suggestionRangeActions: {
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  suggestionReplacementInput: {
    minHeight: 96,
    fontFamily: theme.fontFamily.mono,
  },
  suggestionNoteInput: {
    minHeight: 40,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  commentActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  iconButton: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    ...(isWeb
      ? {
          transitionProperty: "background-color",
          transitionDuration: "120ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  iconButtonDestructiveHovered: {
    backgroundColor: theme.colors.surface3,
  },
  editorBlock: {
    minHeight: INLINE_REVIEW_EDITOR_HEIGHT,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },
  editorInput: {
    flex: 1,
    minHeight: 0,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
    textAlignVertical: "top",
    ...(isWeb
      ? {
          outlineWidth: 0,
          outlineColor: "transparent",
        }
      : {}),
  },
  editorInputFocused: {
    borderColor: theme.colors.accent,
  },
  editorActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
