// @vitest-environment jsdom
import "@/test/window-local-storage";
import { i18n as testI18n } from "@/i18n/i18next";
import { act, fireEvent, render, renderHook, cleanup } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useReviewDraftStore, type ReviewDraftComment } from "./store";
import { buildReviewableDiffTargetKey, type ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  getInlineReviewThreadState,
  getInlineReviewThreadViewportStyle,
  getSplitInlineReviewThreadState,
  groupInlineReviewCommentsByTarget,
  InlineReviewEditor,
  InlineReviewGutterCell,
  InlineReviewThread,
  SMALL_ACTION_HIT_SLOP,
  useInlineReviewController,
  type InlineReviewActions,
} from "./index";

void testI18n;

const { theme, pressablePropsByLabel, electronMac } = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
  return {
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12 },
      borderWidth: { 1: 1 },
      borderRadius: { base: 4, md: 6, lg: 8, xl: 12, full: 999 },
      opacity: { 50: 0.5 },
      fontSize: { xs: 11, sm: 13 },
      fontWeight: { normal: "400", medium: "500" },
      fontFamily: { mono: "monospace" },
      lineHeight: { diff: 18 },
      colors: {
        accent: "#0a84ff",
        accentForeground: "#fff",
        border: "#555",
        destructive: "#ff453a",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        surface1: "#111",
        surface2: "#222",
        surface3: "#333",
        palette: { white: "#fff" },
      },
    },
    pressablePropsByLabel: new Map<string, Record<string, unknown>>(),
    electronMac: { value: false },
  };
});

vi.mock("react-native", async (importOriginal) => {
  const ReactModule = await import("react");
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
      onPointerDown,
      onPointerEnter,
      ...props
    }: {
      accessibilityLabel?: string;
      children?:
        | React.ReactNode
        | ((state: { hovered: boolean; pressed: boolean }) => React.ReactNode);
      onPress?: () => void;
      onPointerDown?: (event: { nativeEvent: PointerEvent }) => void;
      onPointerEnter?: (event: { nativeEvent: PointerEvent }) => void;
      [key: string]: unknown;
    }) => {
      if (accessibilityLabel) {
        pressablePropsByLabel.set(accessibilityLabel, { ...props, onPointerDown, onPointerEnter });
      }
      const resolvedChildren =
        typeof children === "function" ? children({ hovered: false, pressed: false }) : children;
      return ReactModule.createElement(
        "button",
        {
          "aria-label": accessibilityLabel,
          "data-testid": typeof props.testID === "string" ? props.testID : undefined,
          disabled: props.disabled === true,
          onClick: onPress,
          onPointerDown: (event: PointerEvent) =>
            onPointerDown?.({
              nativeEvent: {
                button: event.button ?? 0,
                buttons: event.buttons ?? 0,
                shiftKey: event.shiftKey ?? false,
              } as PointerEvent,
            }),
          onPointerEnter: (event: PointerEvent) =>
            onPointerEnter?.({
              nativeEvent: { buttons: event.buttons ?? 0 } as PointerEvent,
            }),
          type: "button",
        },
        resolvedChildren,
      );
    },
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles: <T,>(component: T) => component,
  useUnistyles: () => ({ theme, rt: { breakpoint: "md" } }),
}));

vi.mock("@/constants/platform", () => ({
  getIsElectron: () => false,
  getIsElectronMac: () => electronMac.value,
  isNative: false,
  isWeb: true,
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    Check: createIcon("Check"),
    CircleDot: createIcon("CircleDot"),
    Code2: createIcon("Code2"),
    Pencil: createIcon("Pencil"),
    Plus: createIcon("Plus"),
    Trash2: createIcon("Trash2"),
    X: createIcon("X"),
  };
});

function target(overrides: Partial<ReviewableDiffTarget> = {}): ReviewableDiffTarget {
  return {
    filePath: "src/example.ts",
    hunkHeader: "@@ -1,2 +1,2 @@",
    hunkIndex: 0,
    lineIndex: 2,
    oldLineNumber: null,
    newLineNumber: 2,
    side: "new",
    lineNumber: 2,
    lineType: "add",
    content: "const value = next;",
    ...overrides,
    key: buildReviewableDiffTargetKey({
      filePath: overrides.filePath ?? "src/example.ts",
      side: overrides.side ?? "new",
      lineNumber: overrides.lineNumber ?? 2,
    }),
  };
}

const EMPTY_COMMENTS: ReviewDraftComment[] = [];
const COMMENT_LIST: ReviewDraftComment[] = [comment()];

function buildReviewActions(overrides: Partial<InlineReviewActions> = {}): InlineReviewActions {
  return {
    canSuggest: false,
    composerMode: null,
    commentsByTarget: new Map(),
    editor: null,
    suggestionsByTarget: new Map(),
    suggestionEditor: null,
    selectedSuggestionTargetKeys: new Set(),
    suggestionRangeError: null,
    onStartComment: vi.fn(),
    onEditComment: vi.fn(),
    onCancelEditor: vi.fn(),
    onSaveEditor: vi.fn(),
    onDeleteComment: vi.fn(),
    onStartSuggestion: vi.fn(),
    onSwitchSuggestionToComment: vi.fn(),
    onBeginSuggestionDrag: vi.fn(),
    onUpdateSuggestionDrag: vi.fn(),
    onShiftSuggestionRange: vi.fn(),
    onPressReviewGutter: vi.fn(),
    onCancelSuggestionRange: vi.fn(),
    onClearSuggestionRangeError: vi.fn(),
    onCancelSuggestion: vi.fn(),
    onEditSuggestion: vi.fn(),
    onExtendSuggestion: vi.fn(),
    onSaveSuggestion: vi.fn(),
    onDeleteSuggestion: vi.fn(),
    ...overrides,
  };
}

function comment(overrides: Partial<ReviewDraftComment> = {}): ReviewDraftComment {
  return {
    id: "comment-1",
    filePath: "src/example.ts",
    side: "new",
    lineNumber: 2,
    body: "Please simplify this.",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("useInlineReviewController", () => {
  beforeEach(() => {
    useReviewDraftStore.setState({ drafts: {}, suggestions: {}, diffModeOverrides: {} });
  });

  afterEach(() => {
    electronMac.value = false;
    cleanup();
    vi.clearAllMocks();
  });

  it("owns draft comment add, edit, delete, cancel, and key-change editor reset", () => {
    const reviewTarget = target();
    const firstKey = "review:key-1";
    const secondKey = "review:key-2";
    const { result, rerender } = renderHook(
      ({ reviewDraftKey }) => useInlineReviewController({ reviewDraftKey }),
      { initialProps: { reviewDraftKey: firstKey } },
    );

    act(() => result.current.onStartComment(reviewTarget));
    expect(result.current.editor).toEqual({ target: reviewTarget, commentId: null, body: "" });

    act(() => result.current.onSaveEditor(" first comment "));
    const savedComment = useReviewDraftStore.getState().drafts[firstKey]?.[0];
    expect(savedComment).toMatchObject({
      filePath: "src/example.ts",
      side: "new",
      lineNumber: 2,
      body: "first comment",
    });
    expect(result.current.editor).toBeNull();
    expect(result.current.commentsByTarget.get(reviewTarget.key)?.[0]).toMatchObject({
      body: "first comment",
    });

    act(() => result.current.onEditComment(reviewTarget, savedComment));
    expect(result.current.editor).toEqual({
      target: reviewTarget,
      commentId: savedComment?.id,
      body: "first comment",
    });

    act(() => result.current.onSaveEditor(" updated comment "));
    const updatedComment = useReviewDraftStore.getState().drafts[firstKey]?.[0];
    expect(updatedComment).toMatchObject({ id: savedComment?.id, body: "updated comment" });

    act(() => result.current.onEditComment(reviewTarget, updatedComment));
    act(() => result.current.onDeleteComment(updatedComment.id));
    expect(useReviewDraftStore.getState().drafts[firstKey]).toEqual([]);
    expect(result.current.editor).toBeNull();

    act(() => result.current.onStartComment(reviewTarget));
    act(() => result.current.onCancelEditor());
    expect(result.current.editor).toBeNull();

    act(() => result.current.onStartComment(reviewTarget));
    rerender({ reviewDraftKey: secondKey });
    expect(result.current.editor).toBeNull();
  });

  it("persists a contiguous multi-line suggestion with its source revision", () => {
    const first = target({ lineNumber: 2, sourceRevision: "revision-1", content: "+old one" });
    const second = target({ lineNumber: 3, sourceRevision: "revision-1", content: " old two" });
    const reviewDraftKey = "review:suggestions";
    const { result } = renderHook(() =>
      useInlineReviewController({
        reviewDraftKey,
        availableTargets: [first, second],
        suggestionsSupported: true,
      }),
    );

    act(() => result.current.onStartSuggestion(first));
    act(() => result.current.onExtendSuggestion("down"));
    expect(result.current.suggestionEditor?.targets).toHaveLength(2);
    act(() => result.current.onSaveSuggestion("new code", "Use the new API"));

    expect(useReviewDraftStore.getState().suggestions[reviewDraftKey]?.[0]).toMatchObject({
      startLine: 2,
      endLine: 3,
      originalLines: ["old one", "old two"],
      replacement: "new code",
      note: "Use the new API",
      sourceRevision: "revision-1",
    });
  });

  it("switches between comment and code-change drafts without losing either draft", () => {
    const reviewTarget = target({ sourceRevision: "revision-1" });
    const { result } = renderHook(() =>
      useInlineReviewController({
        reviewDraftKey: "review:composer-tabs",
        availableTargets: [reviewTarget],
        suggestionsSupported: true,
      }),
    );

    act(() => result.current.onStartComment(reviewTarget));
    act(() => result.current.onStartSuggestion(reviewTarget, "Should this be optional?"));
    expect(result.current.composerMode).toBe("suggestion");
    expect(result.current.editor?.body).toBe("Should this be optional?");
    expect(result.current.suggestionEditor?.note).toBe("Should this be optional?");

    act(() => result.current.onSwitchSuggestionToComment("changed code", "Explain why"));
    expect(result.current.composerMode).toBe("comment");
    expect(result.current.editor?.body).toBe("Explain why");
    expect(result.current.suggestionEditor).toMatchObject({
      replacement: "changed code",
      note: "Explain why",
    });

    act(() => result.current.onStartSuggestion(reviewTarget, "Explain why"));
    expect(result.current.composerMode).toBe("suggestion");
    expect(result.current.suggestionEditor).toMatchObject({
      replacement: "changed code",
      note: "Explain why",
    });
  });

  it("opens a prefilled editor for Shift-selected lines across expanded hunks", () => {
    const first = target({ lineNumber: 20, sourceRevision: "revision-1", content: " first" });
    const middle = target({
      lineNumber: 21,
      hunkIndex: 3,
      sourceRevision: "revision-1",
      content: " middle",
    });
    const last = target({
      lineNumber: 22,
      hunkIndex: 4,
      sourceRevision: "revision-1",
      content: "+last",
    });
    const { result } = renderHook(() =>
      useInlineReviewController({
        reviewDraftKey: "review:range",
        availableTargets: [first, middle, last],
        suggestionsSupported: true,
      }),
    );

    act(() => result.current.onShiftSuggestionRange(first));
    expect(result.current.selectedSuggestionTargetKeys).toEqual(new Set([first.key]));
    act(() => result.current.onShiftSuggestionRange(last));

    expect(result.current.suggestionEditor?.targets).toEqual([first, middle, last]);
    expect(result.current.suggestionEditor?.replacement).toBe("first\nmiddle\nlast");
    expect(result.current.selectedSuggestionTargetKeys).toEqual(
      new Set([first.key, middle.key, last.key]),
    );
  });

  it("reports hidden lines instead of creating an incomplete suggestion", () => {
    const first = target({ lineNumber: 20, sourceRevision: "revision-1" });
    const last = target({ lineNumber: 22, sourceRevision: "revision-1" });
    const { result } = renderHook(() =>
      useInlineReviewController({
        reviewDraftKey: "review:hidden-range",
        availableTargets: [first, last],
        suggestionsSupported: true,
      }),
    );

    act(() => result.current.onShiftSuggestionRange(first));
    act(() => result.current.onShiftSuggestionRange(last));

    expect(result.current.suggestionEditor).toBeNull();
    expect(result.current.suggestionRangeError).toBe("hidden-lines");
  });
});

describe("git diff inline review helpers", () => {
  afterEach(() => {
    electronMac.value = false;
    cleanup();
    vi.clearAllMocks();
    pressablePropsByLabel.clear();
  });

  it("maps persisted draft comments to their reviewable diff target", () => {
    const comments = [
      comment(),
      comment({ id: "comment-2", side: "old", lineNumber: 8 }),
      comment({ id: "comment-3", filePath: "src/other.ts" }),
    ];
    const commentsByTarget = groupInlineReviewCommentsByTarget(comments);

    expect(commentsByTarget.get("src/example.ts:new:2")).toEqual([comments[0]]);
    expect(commentsByTarget.get("src/example.ts:old:8")).toEqual([comments[1]]);
    expect(commentsByTarget.get("src/other.ts:new:2")).toEqual([comments[2]]);
    expect(
      getInlineReviewThreadState({
        reviewTarget: target(),
        reviewActions: buildReviewActions({ commentsByTarget }),
      })?.comments,
    ).toEqual([comments[0]]);
  });

  it("reserves split inline review height from the taller side", () => {
    const leftTarget = target({ side: "old", lineNumber: 8, oldLineNumber: 8 });
    const rightTarget = target();
    const rightComment = comment();
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([rightComment]),
      composerMode: "comment",
      editor: { target: rightTarget, commentId: null, body: "" },
    });

    const rowState = getSplitInlineReviewThreadState({
      left: leftTarget,
      right: rightTarget,
      reviewActions: actions,
    });

    expect(rowState?.left).toBeNull();
    expect(rowState?.right?.comments).toEqual([rightComment]);
    expect(rowState?.height).toBe(246);
  });

  it("pins no-wrap review threads to the visible diff viewport", () => {
    expect(
      getInlineReviewThreadViewportStyle({
        viewportWidth: 320,
        pinToViewport: true,
      }),
    ).toEqual([{ position: "sticky", left: 0 }, inlineUnistylesStyle({ width: 320 })]);
  });

  it("keeps the gutter add-comment target accessible and clicking opens the editor", () => {
    const onStartComment = vi.fn();
    const reviewTarget = target();
    const { getByLabelText } = render(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={EMPTY_COMMENTS}
        isEditorOpen={false}
        onStartComment={onStartComment}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    fireEvent.click(getByLabelText("Add review comment"));
    expect(onStartComment).toHaveBeenCalledWith(reviewTarget);
    expect(pressablePropsByLabel.get("Add review comment")?.hitSlop).toBe(SMALL_ACTION_HIT_SLOP);
  });

  it("keeps the line number visible and only floats the plus for line hover", () => {
    const reviewTarget = target();
    const { container, queryByText, rerender } = render(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={EMPTY_COMMENTS}
        isEditorOpen={false}
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeNull();

    rerender(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={COMMENT_LIST}
        isEditorOpen={false}
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeNull();

    rerender(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={EMPTY_COMMENTS}
        isEditorOpen
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeNull();

    rerender(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        comments={COMMENT_LIST}
        isEditorOpen={false}
        isLineHovered
        onStartComment={vi.fn()}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );

    expect(queryByText("2")).toBeTruthy();
    expect(container.querySelector("[data-icon='Plus']")).toBeTruthy();
  });

  it("routes macOS Shift-click and gutter drag to suggestion range selection", () => {
    electronMac.value = true;
    const reviewTarget = target({ sourceRevision: "revision-1" });
    const actions = buildReviewActions({ canSuggest: true });
    render(
      <InlineReviewGutterCell
        reviewTarget={reviewTarget}
        reviewActions={actions}
        comments={EMPTY_COMMENTS}
        isEditorOpen={false}
        onStartComment={actions.onStartComment}
      >
        <span>2</span>
      </InlineReviewGutterCell>,
    );
    const gutterProps = pressablePropsByLabel.get("Add review comment");
    const onPointerDown = gutterProps?.onPointerDown as
      | ((event: { nativeEvent: Partial<PointerEvent> }) => void)
      | undefined;
    const onPointerEnter = gutterProps?.onPointerEnter as
      | ((event: { nativeEvent: Partial<PointerEvent> }) => void)
      | undefined;

    onPointerDown?.({ nativeEvent: { button: 0, buttons: 1, shiftKey: true } });
    expect(actions.onShiftSuggestionRange).toHaveBeenCalledWith(reviewTarget);
    expect(actions.onBeginSuggestionDrag).not.toHaveBeenCalled();

    onPointerDown?.({ nativeEvent: { button: 0, buttons: 1, shiftKey: false } });
    onPointerEnter?.({ nativeEvent: { buttons: 1 } });
    expect(actions.onBeginSuggestionDrag).toHaveBeenCalledWith(reviewTarget);
    expect(actions.onUpdateSuggestionDrag).toHaveBeenCalledWith(reviewTarget);
  });
});

describe("InlineReviewEditor", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    cleanup();
    vi.clearAllMocks();
  });

  it("saves trimmed bodies and cancels without saving", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const { getByTestId } = render(
      <InlineReviewEditor
        initialBody=" initial "
        onCancel={onCancel}
        onSave={onSave}
        testID="editor"
      />,
    );

    fireEvent.change(getByTestId("editor-input"), { target: { value: " updated comment " } });
    fireEvent.click(getByTestId("editor-save"));
    expect(onSave).toHaveBeenCalledWith("updated comment");

    fireEvent.click(getByTestId("editor-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("switches to the code-change tab with the current comment body", () => {
    const onSuggestEdit = vi.fn();
    const { getByLabelText, getByTestId } = render(
      <InlineReviewEditor
        initialBody=""
        onCancel={vi.fn()}
        onSave={vi.fn()}
        onSuggestEdit={onSuggestEdit}
        testID="editor"
      />,
    );

    fireEvent.change(getByTestId("editor-input"), {
      target: { value: "Should this be optional?" },
    });
    fireEvent.click(getByLabelText("Code change"));
    expect(onSuggestEdit).toHaveBeenCalledWith("Should this be optional?");
  });

  it("handles Escape cancel and Mod+Enter save from the focused textarea", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const { getByTestId } = render(
      <InlineReviewEditor
        initialBody="ready"
        onCancel={onCancel}
        onSave={onSave}
        testID="editor"
      />,
    );
    const input = getByTestId("editor-input");

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onSave).toHaveBeenCalledWith("ready");
  });

  it("shows shared shortcut hints while focused on a fine-pointer screen", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { getByTestId, getByText, queryByText } = render(
      <InlineReviewEditor
        initialBody="ready"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        testID="editor"
      />,
    );
    const input = getByTestId("editor-input");

    expect(getByText("Esc")).toBeTruthy();
    expect(getByText(/(?:⌘⏎|Ctrl\+⏎)/)).toBeTruthy();

    fireEvent.blur(input);
    expect(queryByText("Esc")).toBeNull();
  });
});

describe("InlineReviewThread", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes edit and delete actions for existing comments", () => {
    const reviewTarget = target();
    const draftComment = comment();
    const actions = buildReviewActions({
      commentsByTarget: groupInlineReviewCommentsByTarget([draftComment]),
    });

    const { getByTestId, getByText } = render(
      <InlineReviewThread
        reviewTarget={reviewTarget}
        reviewActions={actions}
        height={76}
        testID="thread"
      />,
    );

    expect(getByText("Please simplify this.")).toBeTruthy();
    fireEvent.click(getByTestId("review-comment-edit-comment-1"));
    expect(actions.onEditComment).toHaveBeenCalledWith(reviewTarget, draftComment);
    fireEvent.click(getByTestId("review-comment-delete-comment-1"));
    expect(actions.onDeleteComment).toHaveBeenCalledWith("comment-1");
  });

  it("switches a new code-change draft back to a comment", () => {
    const reviewTarget = target({ sourceRevision: "revision-1" });
    const actions = buildReviewActions({
      canSuggest: true,
      composerMode: "suggestion",
      suggestionEditor: {
        targets: [reviewTarget],
        suggestionId: null,
        replacement: "const value = changed;",
        note: "Explain why",
        sourceRevision: "revision-1",
      },
    });
    const { getByLabelText } = render(
      <InlineReviewThread reviewTarget={reviewTarget} reviewActions={actions} height={316} />,
    );

    fireEvent.click(getByLabelText("Comment"));
    expect(actions.onSwitchSuggestionToComment).toHaveBeenCalledWith(
      "const value = changed;",
      "Explain why",
    );
  });
});
