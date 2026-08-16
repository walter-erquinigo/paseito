import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { DiffStat } from "@/components/diff-stat";
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type PressableStateCallbackType,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BORDER_WIDTH, ICON_SIZE, SPACING, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor, WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import {
  AlignJustify,
  ChevronDown,
  Columns2,
  FolderTree,
  List,
  ListChecks,
  ListChevronsDownUp,
  ListChevronsUpDown,
  ListTodo,
  Maximize2,
  Pilcrow,
  RotateCw,
  Square,
  SquareCheckBig,
  WrapText,
} from "lucide-react-native";
import { type ParsedDiffFile, type DiffLine, type HighlightToken } from "@/git/use-diff-query";
import { buildDiffFlatItems, sumHeightsBefore, type DiffFlatItem } from "@/git/diff-flat-items";
import type { ChangesSearchMatch, ChangesSearchResult } from "@/git/changes-search";
import type { ChangesLspController } from "@/git/use-changes-lsp";
import { useChangesLsp } from "@/git/use-changes-lsp";
import { LspStatusMenu } from "@/file-pane/lsp-status-menu";
import { lspLanguageForFile } from "@/file-pane/editor/lsp-preferences";
import { resolveChangesLspTarget, type ChangesLspTarget } from "@/git/changes-lsp-target";
import { buildDiffTree, collectDirPaths, compressSingleChildChains } from "@/git/diff-tree";
import { DiffFolderRow } from "@/git/diff-folder-row";
import {
  TreeIndentGuides,
  treeRowPaddingLeft,
  WORKSPACE_FILE_ROW_TRAILING_PADDING,
  WORKSPACE_FILE_ROW_VERTICAL_PADDING,
  WORKSPACE_TREE_ICON_LABEL_GAP,
  WORKSPACE_TREE_ICON_SIZE,
} from "@/components/tree-primitives";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { FileChangeIcon } from "@/components/file-change-icon";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { CommitsSection } from "@/git/commits-section/commits-section";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings } from "@/hooks/use-settings";
import { DiffScroll } from "@/components/diff-scroll";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { shouldAnchorHeaderBeforeCollapse } from "@/git/diff-scroll";
import {
  buildSplitDiffRows,
  buildUnifiedDiffLines,
  type ReviewableDiffTarget,
  type SplitDiffDisplayLine,
  type SplitDiffRow,
} from "@/utils/diff-layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as Clipboard from "expo-clipboard";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useFileDownload } from "@/hooks/use-file-download";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { BranchSwitcher } from "@/components/branch-switcher";
import { useGitActions } from "@/git/use-actions";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { buildForgeSignInCommand, getForgePresentation, type Forge } from "@/git/forge";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import type { ForgeAuthState } from "@getpaseo/protocol/messages";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useOverlayFlatListScrollbar } from "@/components/ui/overlay-scrollbar/use-overlay-flat-list-scrollbar";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { usePanelStore } from "@/stores/panel-store";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceWorkingDiffTabTarget,
} from "@/workspace-tabs/model";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import {
  formatDiffContentText,
  formatDiffGutterText,
  hasVisibleDiffTokens,
} from "@/utils/diff-rendering";
import { isWeb, isNative } from "@/constants/platform";
import { useWorkspaceFileDragSource } from "@/attachments/use-workspace-file-drag-source";
import {
  type ReviewDraftComment,
  getInlineReviewThreadState,
  getSplitInlineReviewThreadState,
  InlineReviewGutterCell,
  InlineReviewThread,
  isInlineReviewEditorForTarget,
  SMALL_ACTION_HIT_SLOP,
  type InlineReviewActions,
  type FileReviewActions,
  type ReviewableChangedLine,
  useReviewAttachmentSnapshot,
} from "@/review";
import { usePublishWorkingDiffAttachment, useWorkingDiff } from "@/git/use-working-diff";
import { DiffTooLargeState } from "@/git/diff-too-large-state";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { ChangesBaseSelector } from "@/git/changes-base-selector";
import { applyChangesBaseSelection } from "@/git/changes-base-selection";
import {
  buildDiffContextRegions,
  parseDiffContextMarker,
  type DiffContextRegion,
} from "@/git/diff-context-expansion";
import {
  collapseReviewedFile,
  expandOnlyUnreviewedFiles,
  expandInvalidatedFiles,
  expandUnreviewedFile,
  revealFileAncestorFolders,
} from "@/git/file-review-expansion";
import {
  findAdjacentHiddenContext,
  findNextUncheckedLine,
  getLineReviewKeyboardAction,
  isReviewTargetFullyVisible,
  shouldCenterReviewTarget,
} from "@/review/line-review-navigation";
import {
  clearInlineWorkingDiffNavigationSnapshot,
  publishInlineWorkingDiffNavigationSnapshot,
} from "@/workspace/markdown-changes-navigation";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

export function resolveDiffLayout(
  layout: "unified" | "split",
  canUseSplitLayout: boolean,
): "unified" | "split" {
  return canUseSplitLayout ? layout : "unified";
}

function supportsSplitDiffLayout(isMobile: boolean): boolean {
  return isWeb && !isMobile;
}

function fileHeaderPressableStyle(
  { hovered, pressed }: PressableStateCallbackType & { hovered?: boolean },
  isSelected: boolean,
) {
  return [
    styles.fileHeader,
    (Boolean(hovered) || pressed || isSelected) && styles.fileHeaderActive,
  ];
}

interface HighlightedTextProps {
  tokens: HighlightToken[];
  textMetricsStyle: TextStyle;
  wrapLines?: boolean;
  testID?: string;
}

const DIFF_SOURCE_TEXT_DATASET = { paseitoDiffSourceText: "true" } as const;

type WrappedWebTextStyle = TextStyle & {
  whiteSpace?: "pre" | "pre-wrap";
  overflowWrap?: "normal" | "anywhere";
};

function getWrappedTextStyle(wrapLines: boolean): WrappedWebTextStyle | undefined {
  if (isNative) {
    return undefined;
  }
  return wrapLines
    ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
    : { whiteSpace: "pre", overflowWrap: "normal" };
}

function getNumericLineHeight(textMetricsStyle: TextStyle): number | undefined {
  const { lineHeight } = textMetricsStyle;
  return typeof lineHeight === "number" && Number.isFinite(lineHeight) ? lineHeight : undefined;
}

function useDiffRowMetricsStyle(textMetricsStyle: TextStyle): StyleProp<ViewStyle> {
  const lineHeight = getNumericLineHeight(textMetricsStyle);
  return useMemo(
    () => (lineHeight !== undefined ? inlineUnistylesStyle({ minHeight: lineHeight }) : null),
    [lineHeight],
  );
}

function HighlightedToken({ token }: { token: HighlightToken }) {
  return <Text style={syntaxTokenStyleFor(token.style)}>{token.text}</Text>;
}

function HighlightedText({
  tokens,
  textMetricsStyle,
  wrapLines = false,
  testID,
}: HighlightedTextProps) {
  const containerStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
    ],
    [textMetricsStyle, wrapLines],
  );

  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );

  return (
    <Text style={containerStyle} testID={testID} dataSet={DIFF_SOURCE_TEXT_DATASET}>
      {keyedTokens.map(({ key, token }) => (
        <HighlightedToken key={key} token={token} />
      ))}
    </Text>
  );
}

interface DiffFileSectionProps {
  file: ParsedDiffFile;
  workspaceFileDragScope?: { serverId: string; workspaceId: string };
  isExpanded: boolean;
  isSelected?: boolean;
  /** Tree indentation level (0 on the flat/mobile path). */
  depth?: number;
  /** Show the muted directory suffix (flat list); false inside the folder tree. */
  showDir?: boolean;
  interactive?: boolean;
  onToggle?: (path: string) => void;
  onSelect?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onAddToChat?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onReveal?: (path: string) => void;
  revealTargetName?: string;
  onDownload?: (path: string) => void;
  onDuplicate?: (path: string) => void;
  onRevert?: (path: string, oldPath?: string) => void;
  onHeaderHeightChange?: (path: string, height: number) => void;
  fileReviews?: FileReviewActions;
  onToggleReviewed?: (path: string) => void;
  onExpandFile?: (path: string) => void;
  isExpandingFile?: boolean;
  lsp?: ChangesLspController;
  testID?: string;
}

const EMPTY_COMMENTS: readonly ReviewDraftComment[] = [];

function noopStartComment(): void {}

function useDiscardChangesAction({
  serverId,
  cwd,
  diffMode,
}: {
  serverId: string;
  cwd: string;
  diffMode: "uncommitted" | "base";
}): ((path: string, oldPath?: string) => void) | undefined {
  const { t } = useTranslation();
  const toast = useToast();
  const discardChanges = useCheckoutGitActionsStore((state) => state.discardChanges);
  // COMPAT(checkoutDiscardChanges): added in v0.3.0, remove gate after 2027-02-08.
  const discardSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutDiscardChanges === true,
  );
  const discardPath = useCallback(
    async (path: string, oldPath?: string) => {
      const confirmed = await confirmDialog({
        title: t("workspace.fileActions.confirmRevert.title"),
        message: t("workspace.fileActions.confirmRevert.message", {
          name: path,
        }),
        confirmLabel: t("workspace.fileActions.confirmRevert.confirm"),
        cancelLabel: t("workspace.fileActions.confirmRevert.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        await discardChanges({
          serverId,
          cwd,
          paths: oldPath ? [path, oldPath] : [path],
        });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileActions.confirmRevert.failed"),
        );
      }
    },
    [cwd, discardChanges, serverId, t, toast],
  );
  const handleDiscardPath = useCallback(
    (path: string, oldPath?: string) => {
      void discardPath(path, oldPath);
    },
    [discardPath],
  );
  return discardSupported && diffMode === "uncommitted" ? handleDiscardPath : undefined;
}

function isReviewRangeTargetSelected(
  reviewTarget: ReviewableDiffTarget | null | undefined,
  reviewActions: InlineReviewActions | undefined,
): boolean {
  return Boolean(reviewTarget && reviewActions?.selectedRangeTargetKeys.has(reviewTarget.key));
}

const DIFF_LINE_HOVER_STYLE = isWeb ? ({ cursor: "auto" } as const) : null;
const DIFF_REVIEW_SURFACE_DATASET = {
  paseitoDiffReviewSurface: "true",
} as const;
const LINE_REVIEW_GUTTER_WIDTH = 22;
const DIFF_CONTEXT_CONTROL_HEIGHT = 20;

interface LineReviewPresentation {
  fileReviews: FileReviewActions;
  selectedLineId: string | null;
  onSelectLine: (line: ReviewableChangedLine) => void;
  onToggleLine: (line: ReviewableChangedLine) => void;
}

interface DiffNavigationHighlight {
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

interface ChangesSearchState {
  open: boolean;
  query: string;
  status: "idle" | "loading" | "ready" | "error";
  matches: ChangesSearchMatch[];
  selectedIndex: number;
  truncated: boolean;
  error: string | null;
}

const CLOSED_CHANGES_SEARCH: ChangesSearchState = {
  open: false,
  query: "",
  status: "idle",
  matches: [],
  selectedIndex: -1,
  truncated: false,
  error: null,
};

function getChangesSearchStatusLabel(state: ChangesSearchState, t: TFunction): string {
  if (state.status === "loading") return t("workspace.git.diff.search.loading");
  if (state.status === "error") return state.error ?? t("workspace.git.diff.search.failed");
  if (state.matches.length > 0) {
    return `${state.selectedIndex + 1}/${state.matches.length}${state.truncated ? "+" : ""}`;
  }
  if (state.status === "ready") return t("workspace.git.diff.search.noMatches");
  return t("workspace.git.diff.search.submit");
}

function getCurrentNavigationLine(
  reviewTarget: ReviewableDiffTarget | null | undefined,
): number | null {
  return reviewTarget?.side === "new" ? (reviewTarget.newLineNumber ?? null) : null;
}

function isDiffNavigationHighlighted(
  reviewTarget: ReviewableDiffTarget | null | undefined,
  navigation: DiffNavigationHighlight | undefined,
): boolean {
  const lineNumber = getCurrentNavigationLine(reviewTarget);
  return Boolean(
    navigation &&
    reviewTarget?.filePath === navigation.filePath &&
    lineNumber !== null &&
    lineNumber >= navigation.lineStart &&
    lineNumber <= navigation.lineEnd,
  );
}

function findVerticalScrollViewport(element: HTMLElement): HTMLElement | null {
  let viewport = element.parentElement;
  while (viewport) {
    const style = getComputedStyle(viewport);
    const scrollable = style.overflowY === "auto" || style.overflowY === "scroll";
    if (viewport.scrollHeight > viewport.clientHeight && scrollable) return viewport;
    viewport = viewport.parentElement;
  }
  return null;
}

function revealReviewElement(input: {
  element: HTMLElement;
  file: ParsedDiffFile | undefined;
  line: ReviewableChangedLine;
  escapeSelector(value: string): string;
  focus(): void;
}) {
  const viewport = findVerticalScrollViewport(input.element);
  if (!viewport) {
    input.element.scrollIntoView({ block: "center", inline: "nearest" });
    input.focus();
    return;
  }
  const viewportBounds = viewport.getBoundingClientRect();
  const currentLine = input.line.target.newLineNumber ?? input.line.target.editLineNumber;
  const renderedLinesAfter =
    input.file?.newLineCount && currentLine
      ? Math.max(0, input.file.newLineCount - currentLine)
      : 0;
  const surface = input.element.closest<HTMLElement>("[data-paseito-diff-review-surface]");
  const sameFileLines = surface?.querySelectorAll<HTMLElement>(
    `[data-paseito-diff-file="${input.escapeSelector(
      input.line.target.filePath,
    )}"][data-paseito-diff-current-line]`,
  );
  const visibleFollowingLines = new Set<number>();
  for (const candidate of sameFileLines ?? []) {
    const lineNumber = Number(candidate.dataset.paseitoDiffCurrentLine);
    if (!currentLine || lineNumber <= currentLine) continue;
    const bounds = candidate.getBoundingClientRect();
    if (bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom) {
      visibleFollowingLines.add(lineNumber);
    }
  }
  if (
    shouldCenterReviewTarget({
      isFullyVisible: isReviewTargetFullyVisible({
        viewport: viewportBounds,
        target: input.element.getBoundingClientRect(),
      }),
      renderedLinesAfter,
      visibleLinesAfter: visibleFollowingLines.size,
    })
  ) {
    input.element.scrollIntoView({ block: "center", inline: "nearest" });
  }
  input.focus();
}

function LineReviewCheckbox({
  line,
  presentation,
}: {
  line: ReviewableChangedLine;
  presentation: LineReviewPresentation;
}) {
  const { t } = useTranslation();
  const reviewed = presentation.fileReviews.reviewedLineIds.has(line.id);
  const selected = presentation.selectedLineId === line.id;
  const accessibilityState = useMemo(() => ({ checked: reviewed }), [reviewed]);
  const handlePress = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      presentation.onSelectLine(line);
      presentation.onToggleLine(line);
    },
    [line, presentation],
  );
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={t(
        reviewed ? "workspace.git.diff.markLineUnreviewed" : "workspace.git.diff.markLineReviewed",
        { line: line.target.lineNumber },
      )}
      hitSlop={SMALL_ACTION_HIT_SLOP}
      onPress={handlePress}
      style={styles.lineReviewButton}
      testID={`diff-line-review-${line.target.key}`}
    >
      {selected ? (
        <View
          pointerEvents="none"
          style={styles.lineReviewFocusMarker}
          testID={`diff-review-focus-${line.target.key}`}
        />
      ) : null}
      {reviewed ? (
        <ThemedSquareCheckBig size={14} uniProps={reviewedIconColorMapping} />
      ) : (
        <ThemedSquare size={14} uniProps={foregroundMutedIconColorMapping} />
      )}
    </Pressable>
  );
}

function LongPressableLine({
  reviewTarget,
  reviewActions,
  onHoverChange,
  hoverTargetKey,
  onHoverTargetChange,
  style,
  children,
  lineReview,
  navigation,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions: InlineReviewActions | undefined;
  onHoverChange?: (hovered: boolean) => void;
  hoverTargetKey?: string | null;
  onHoverTargetChange?: (key: string | null) => void;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const onStartComment = reviewActions?.onStartComment;
  const handlePress = useCallback(() => {
    const selection = isWeb ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return;
    }
    const changedLine = reviewTarget
      ? lineReview?.fileReviews.lineByTargetKey.get(reviewTarget.key)
      : null;
    if (changedLine && lineReview) {
      lineReview.onSelectLine(changedLine);
      return;
    }
    if (reviewTarget && onStartComment && isNative) {
      onStartComment(reviewTarget);
    }
  }, [lineReview, reviewTarget, onStartComment]);

  const handleHoverIn = useCallback(() => {
    onHoverChange?.(true);
    if (hoverTargetKey) {
      onHoverTargetChange?.(hoverTargetKey);
    }
  }, [hoverTargetKey, onHoverChange, onHoverTargetChange]);
  const handleHoverOut = useCallback(() => {
    onHoverChange?.(false);
    if (hoverTargetKey) {
      onHoverTargetChange?.(null);
    }
  }, [hoverTargetKey, onHoverChange, onHoverTargetChange]);
  const changedLine = reviewTarget
    ? lineReview?.fileReviews.lineByTargetKey.get(reviewTarget.key)
    : null;
  const selected = Boolean(changedLine && lineReview?.selectedLineId === changedLine.id);
  const navigationHighlighted = isDiffNavigationHighlighted(reviewTarget, navigation);
  const currentLineNumber = getCurrentNavigationLine(reviewTarget);
  const reviewTargetDataSet = useMemo(
    () =>
      reviewTarget
        ? {
            paseitoReviewTargetKey: reviewTarget.key,
            paseitoReviewSelected: selected ? "true" : "false",
            ...(currentLineNumber !== null
              ? {
                  paseitoDiffFile: reviewTarget.filePath,
                  paseitoDiffCurrentLine: String(currentLineNumber),
                  paseitoDiffNavigationSelected: navigationHighlighted ? "true" : "false",
                }
              : {}),
          }
        : undefined,
    [currentLineNumber, navigationHighlighted, reviewTarget, selected],
  );
  const rowStyle = useMemo(
    () => [
      style,
      navigationHighlighted && styles.diffNavigationHighlight,
      selected && styles.selectedReviewLine,
    ],
    [navigationHighlighted, selected, style],
  );
  const hoverStyle = useMemo(() => [rowStyle, DIFF_LINE_HOVER_STYLE], [rowStyle]);

  if (changedLine && lineReview) {
    return (
      <Pressable
        dataSet={reviewTargetDataSet}
        onPress={handlePress}
        onHoverIn={isWeb ? handleHoverIn : undefined}
        onHoverOut={isWeb ? handleHoverOut : undefined}
        style={rowStyle}
      >
        {children}
      </Pressable>
    );
  }

  if (isWeb && (onHoverChange || onHoverTargetChange)) {
    return (
      <Pressable
        dataSet={reviewTargetDataSet}
        onPress={changedLine ? handlePress : undefined}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={hoverStyle}
      >
        {children}
      </Pressable>
    );
  }

  if (!isNative || !reviewTarget || !onStartComment) {
    return (
      <View dataSet={reviewTargetDataSet} style={rowStyle}>
        {children}
      </View>
    );
  }
  return (
    <Pressable onPress={handlePress} style={rowStyle}>
      {children}
    </Pressable>
  );
}

function lineTypeBackground(type: DiffLine["type"] | undefined | null) {
  if (!type) return styles.emptySplitCell;
  if (type === "add") return styles.addLineContainer;
  if (type === "remove") return styles.removeLineContainer;
  if (type === "header") return styles.headerLineContainer;
  return styles.contextLineContainer;
}

function DiffGutterCell({
  lineNumber,
  type,
  gutterWidth,
  textMetricsStyle,
  reviewTarget,
  reviewActions,
  isLineHovered,
  style,
  testID,
  textTestID,
  actionTestID,
  lineReview,
  rowHeight,
  navigation,
}: {
  lineNumber: number | null;
  type: DiffLine["type"] | undefined | null;
  gutterWidth: number;
  textMetricsStyle: TextStyle;
  reviewTarget?: ReviewableDiffTarget | null;
  reviewActions?: InlineReviewActions;
  isLineHovered?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  textTestID?: string;
  actionTestID?: string;
  lineReview?: LineReviewPresentation;
  rowHeight?: number;
  navigation?: DiffNavigationHighlight;
}) {
  const lineHeight = getNumericLineHeight(textMetricsStyle);
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);
  const changedLine = reviewTarget
    ? lineReview?.fileReviews.lineByTargetKey.get(reviewTarget.key)
    : null;
  const selected = Boolean(changedLine && lineReview?.selectedLineId === changedLine.id);
  const navigationHighlighted = isDiffNavigationHighlighted(reviewTarget, navigation);
  const containerStyle = useMemo(
    () => [
      styles.gutterCell,
      lineTypeBackground(type),
      isReviewRangeTargetSelected(reviewTarget, reviewActions) && styles.suggestionSelectionLine,
      navigationHighlighted && styles.diffNavigationHighlight,
      selected && styles.selectedReviewLine,
      rowMetricsStyle,
      rowHeight !== undefined && inlineUnistylesStyle({ height: rowHeight, minHeight: rowHeight }),
      inlineUnistylesStyle({ width: gutterWidth }),
      style,
    ],
    [
      type,
      reviewActions,
      reviewTarget,
      navigationHighlighted,
      selected,
      rowMetricsStyle,
      rowHeight,
      gutterWidth,
      style,
    ],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.lineNumberText,
      type === "add" && styles.addLineNumberText,
      type === "remove" && styles.removeLineNumberText,
    ],
    [textMetricsStyle, type],
  );
  const comments = useMemo(
    () =>
      reviewTarget
        ? (reviewActions?.commentsByTarget.get(reviewTarget.key) ?? EMPTY_COMMENTS)
        : EMPTY_COMMENTS,
    [reviewTarget, reviewActions?.commentsByTarget],
  );
  const isEditorOpen = isInlineReviewEditorForTarget(reviewActions?.editor ?? null, reviewTarget);
  const onStartComment = reviewActions?.onStartComment ?? noopStartComment;

  return (
    <InlineReviewGutterCell
      reviewTarget={reviewTarget}
      comments={comments}
      isEditorOpen={isEditorOpen}
      isLineHovered={isLineHovered}
      lineHeight={lineHeight}
      onStartComment={onStartComment}
      reviewActions={reviewActions}
      style={containerStyle}
      actionTestID={actionTestID}
      testID={testID}
    >
      <View style={styles.lineReviewGutterContent}>
        {lineReview ? (
          <View style={styles.lineReviewGutterSlot}>
            {changedLine ? (
              <LineReviewCheckbox line={changedLine} presentation={lineReview} />
            ) : null}
          </View>
        ) : null}
        <Text numberOfLines={1} style={textStyle} testID={textTestID}>
          {formatDiffGutterText(lineNumber)}
        </Text>
      </View>
    </InlineReviewGutterCell>
  );
}

function DiffContextControl({
  region,
  onExpand,
}: {
  region: DiffContextRegion;
  onExpand: (region: DiffContextRegion, direction: "up" | "down" | "all") => void;
}) {
  const { t } = useTranslation();
  const expandUp = useCallback(() => onExpand(region, "up"), [onExpand, region]);
  const expandDown = useCallback(() => onExpand(region, "down"), [onExpand, region]);
  const expandAll = useCallback(() => onExpand(region, "all"), [onExpand, region]);
  return (
    <View style={styles.contextControl} testID="diff-context-control">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.context.expandUp")}
        onPress={expandUp}
        style={styles.contextControlButton}
      >
        <Text style={styles.contextControlButtonText}>↑</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.context.expandAll")}
        onPress={expandAll}
        style={styles.contextControlLabelButton}
      >
        <Text style={styles.contextControlText}>
          {t("workspace.git.diff.context.hiddenLines", {
            count: region.lineCount,
          })}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.context.expandDown")}
        onPress={expandDown}
        style={styles.contextControlButton}
      >
        <Text style={styles.contextControlButtonText}>↓</Text>
      </Pressable>
    </View>
  );
}

function DiffCodeContent({
  line,
  visibleTokens,
  textMetricsStyle,
  wrapLines,
  textStyle,
  textTestID,
  onExpandContext,
}: {
  line: DiffLine;
  visibleTokens: HighlightToken[] | null | undefined;
  textMetricsStyle: TextStyle;
  wrapLines: boolean;
  textStyle: StyleProp<TextStyle>;
  textTestID?: string;
  onExpandContext?: (region: DiffContextRegion, direction: "up" | "down" | "all") => void;
}) {
  const contextRegion = parseDiffContextMarker(line.content);
  if (contextRegion && onExpandContext) {
    return <DiffContextControl region={contextRegion} onExpand={onExpandContext} />;
  }
  if (line.type !== "header" && visibleTokens) {
    return (
      <HighlightedText
        tokens={visibleTokens}
        textMetricsStyle={textMetricsStyle}
        wrapLines={wrapLines}
        testID={textTestID}
      />
    );
  }
  return (
    <Text
      style={textStyle}
      testID={textTestID}
      dataSet={line.type === "header" ? undefined : DIFF_SOURCE_TEXT_DATASET}
    >
      {formatDiffContentText(line.content)}
    </Text>
  );
}

function DiffTextLine({
  line,
  wrapLines,
  textMetricsStyle,
  reviewTarget,
  reviewActions,
  onHoverChange,
  hoverTargetKey,
  onHoverTargetChange,
  textTestID,
  onExpandContext,
  lineReview,
  navigation,
}: {
  line: DiffLine;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewTarget?: ReviewableDiffTarget | null;
  reviewActions?: InlineReviewActions;
  onHoverChange?: (hovered: boolean) => void;
  hoverTargetKey?: string | null;
  onHoverTargetChange?: (key: string | null) => void;
  textTestID?: string;
  onExpandContext?: (region: DiffContextRegion, direction: "up" | "down" | "all") => void;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const visibleTokens = hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [
      styles.textLineContainer,
      lineTypeBackground(line.type),
      isReviewRangeTargetSelected(reviewTarget, reviewActions) && styles.suggestionSelectionLine,
      rowMetricsStyle,
    ],
    [line.type, reviewActions, reviewTarget, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line.type === "add" && styles.addLineText,
      line.type === "remove" && styles.removeLineText,
      line.type === "header" && styles.headerLineText,
      line.type === "context" && styles.contextLineText,
    ],
    [line.type, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={onHoverChange}
      hoverTargetKey={hoverTargetKey}
      onHoverTargetChange={onHoverTargetChange}
      style={containerStyle}
      lineReview={lineReview}
      navigation={navigation}
    >
      <DiffCodeContent
        line={line}
        visibleTokens={visibleTokens}
        textMetricsStyle={textMetricsStyle}
        wrapLines={wrapLines}
        textStyle={textStyle}
        textTestID={textTestID}
        onExpandContext={onExpandContext}
      />
    </LongPressableLine>
  );
}

function SplitTextLine({
  line,
  wrapLines,
  textMetricsStyle,
  reviewActions,
  onHoverChange,
  hoverTargetKey,
  onHoverTargetChange,
  lineReview,
  navigation,
}: {
  line: SplitDiffDisplayLine | null;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  onHoverChange?: (hovered: boolean) => void;
  hoverTargetKey?: string | null;
  onHoverTargetChange?: (key: string | null) => void;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const visibleTokens = line && hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [
      styles.textLineContainer,
      lineTypeBackground(line?.type),
      isReviewRangeTargetSelected(line?.reviewTarget, reviewActions) &&
        styles.suggestionSelectionLine,
      rowMetricsStyle,
    ],
    [line?.reviewTarget, line?.type, reviewActions, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line?.type === "add" && styles.addLineText,
      line?.type === "remove" && styles.removeLineText,
      line?.type === "context" && styles.contextLineText,
      !line && styles.emptySplitCellText,
    ],
    [line, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={line?.reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={onHoverChange}
      hoverTargetKey={hoverTargetKey}
      onHoverTargetChange={onHoverTargetChange}
      style={containerStyle}
      lineReview={lineReview}
      navigation={navigation}
    >
      {visibleTokens ? (
        <HighlightedText
          tokens={visibleTokens}
          textMetricsStyle={textMetricsStyle}
          wrapLines={wrapLines}
        />
      ) : (
        <Text style={textStyle} dataSet={line ? DIFF_SOURCE_TEXT_DATASET : undefined}>
          {formatDiffContentText(line?.content)}
        </Text>
      )}
    </LongPressableLine>
  );
}

function DiffLineView({
  line,
  lineNumber,
  gutterWidth,
  wrapLines,
  textMetricsStyle,
  reviewTarget,
  reviewActions,
  onExpandContext,
  lineReview,
  navigation,
}: {
  line: DiffLine;
  lineNumber: number | null;
  gutterWidth: number;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewTarget?: ReviewableDiffTarget | null;
  reviewActions?: InlineReviewActions;
  onExpandContext?: (region: DiffContextRegion, direction: "up" | "down" | "all") => void;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const [isLineHovered, setIsLineHovered] = useState(false);
  const visibleTokens = hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [
      styles.diffLineContainer,
      lineTypeBackground(line.type),
      isReviewRangeTargetSelected(reviewTarget, reviewActions) && styles.suggestionSelectionLine,
      rowMetricsStyle,
    ],
    [line.type, reviewActions, reviewTarget, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line.type === "add" && styles.addLineText,
      line.type === "remove" && styles.removeLineText,
      line.type === "header" && styles.headerLineText,
      line.type === "context" && styles.contextLineText,
    ],
    [line.type, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={setIsLineHovered}
      style={containerStyle}
      lineReview={lineReview}
      navigation={navigation}
    >
      <DiffGutterCell
        lineNumber={lineNumber}
        type={line.type}
        gutterWidth={gutterWidth}
        textMetricsStyle={textMetricsStyle}
        reviewTarget={reviewTarget}
        reviewActions={reviewActions}
        isLineHovered={isLineHovered}
        style={styles.lineNumberGutter}
        lineReview={lineReview}
        navigation={navigation}
      />
      <DiffCodeContent
        line={line}
        visibleTokens={visibleTokens}
        textMetricsStyle={textMetricsStyle}
        wrapLines={wrapLines}
        textStyle={textStyle}
        onExpandContext={onExpandContext}
      />
    </LongPressableLine>
  );
}

function SplitDiffLine({
  line,
  gutterWidth,
  wrapLines,
  textMetricsStyle,
  reviewActions,
  lineReview,
  navigation,
}: {
  line: SplitDiffDisplayLine | null;
  gutterWidth: number;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const [isLineHovered, setIsLineHovered] = useState(false);
  const visibleTokens = line && hasVisibleDiffTokens(line.tokens) ? line.tokens : null;
  const rowMetricsStyle = useDiffRowMetricsStyle(textMetricsStyle);

  const containerStyle = useMemo(
    () => [
      styles.diffLineContainer,
      lineTypeBackground(line?.type),
      isReviewRangeTargetSelected(line?.reviewTarget, reviewActions) &&
        styles.suggestionSelectionLine,
      rowMetricsStyle,
    ],
    [line?.reviewTarget, line?.type, reviewActions, rowMetricsStyle],
  );
  const textStyle = useMemo(
    () => [
      styles.diffTextMetrics,
      textMetricsStyle,
      styles.diffLineText,
      getWrappedTextStyle(wrapLines),
      line?.type === "add" && styles.addLineText,
      line?.type === "remove" && styles.removeLineText,
      line?.type === "context" && styles.contextLineText,
      !line && styles.emptySplitCellText,
    ],
    [line, textMetricsStyle, wrapLines],
  );

  return (
    <LongPressableLine
      reviewTarget={line?.reviewTarget}
      reviewActions={reviewActions}
      onHoverChange={setIsLineHovered}
      style={containerStyle}
      lineReview={lineReview}
      navigation={navigation}
    >
      <DiffGutterCell
        lineNumber={line?.lineNumber ?? null}
        type={line?.type}
        gutterWidth={gutterWidth}
        textMetricsStyle={textMetricsStyle}
        reviewTarget={line?.reviewTarget}
        reviewActions={reviewActions}
        isLineHovered={isLineHovered}
        style={styles.lineNumberGutter}
        lineReview={lineReview}
        navigation={navigation}
      />
      {visibleTokens ? (
        <HighlightedText
          tokens={visibleTokens}
          textMetricsStyle={textMetricsStyle}
          wrapLines={wrapLines}
        />
      ) : (
        <Text style={textStyle} dataSet={line ? DIFF_SOURCE_TEXT_DATASET : undefined}>
          {formatDiffContentText(line?.content)}
        </Text>
      )}
    </LongPressableLine>
  );
}

function InlineReviewThreadContent({
  reviewTarget,
  reviewActions,
  reservedHeight,
  viewportWidth,
  pinToViewport,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
  reservedHeight?: number;
  viewportWidth?: number;
  pinToViewport?: boolean;
}) {
  const threadState = getInlineReviewThreadState({
    reviewTarget,
    reviewActions,
  });
  const height = reservedHeight ?? threadState?.height ?? 0;
  const placeholderStyle = useMemo<ViewStyle>(
    () => inlineUnistylesStyle({ minHeight: height }),
    [height],
  );
  if (height === 0) {
    return null;
  }
  if (!reviewTarget || !reviewActions || !threadState) {
    return <View style={placeholderStyle} />;
  }

  return (
    <InlineReviewThread
      reviewTarget={reviewTarget}
      reviewActions={reviewActions}
      height={height}
      viewportWidth={viewportWidth}
      pinToViewport={pinToViewport}
      testID={`review-thread-${reviewTarget.key}`}
    />
  );
}

function InlineReviewGutterSpacer({
  reviewTarget,
  reviewActions,
  gutterWidth,
  reservedHeight,
  style,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
  gutterWidth: number;
  reservedHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const threadState = getInlineReviewThreadState({
    reviewTarget,
    reviewActions,
  });
  const height = reservedHeight ?? threadState?.height ?? 0;
  const spacerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.inlineReviewGutterSpacer,
      inlineUnistylesStyle({ width: gutterWidth, minHeight: height }),
      style,
    ],
    [gutterWidth, height, style],
  );
  if (height === 0) {
    return null;
  }

  return <View style={spacerStyle} />;
}

function InlineReviewRow({
  reviewTarget,
  reviewActions,
  gutterWidth,
  reservedHeight,
}: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  reviewActions?: InlineReviewActions;
  gutterWidth: number;
  reservedHeight?: number;
}) {
  const threadState = getInlineReviewThreadState({
    reviewTarget,
    reviewActions,
  });
  const height = reservedHeight ?? threadState?.height ?? 0;
  const gutterSpacerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.inlineReviewGutterSpacer, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const placeholderStyle = useMemo<ViewStyle>(
    () => inlineUnistylesStyle({ minHeight: height }),
    [height],
  );
  if (height === 0) {
    return null;
  }

  return (
    <View style={styles.inlineReviewRow}>
      <View style={gutterSpacerStyle} />
      {reviewTarget && reviewActions && threadState ? (
        <InlineReviewThread
          reviewTarget={reviewTarget}
          reviewActions={reviewActions}
          height={height}
          testID={`review-thread-${reviewTarget.key}`}
        />
      ) : (
        <View style={placeholderStyle} />
      )}
    </View>
  );
}

function SplitHeaderContent({
  content,
  side,
  textStyle,
  onExpandContext,
}: {
  content: string;
  side: "left" | "right";
  textStyle: StyleProp<TextStyle>;
  onExpandContext?: (region: DiffContextRegion, direction: "up" | "down" | "all") => void;
}) {
  const contextRegion = parseDiffContextMarker(content);
  if (!contextRegion) return <Text style={textStyle}>{content}</Text>;
  if (side === "right" && onExpandContext) {
    return <DiffContextControl region={contextRegion} onExpand={onExpandContext} />;
  }
  return null;
}

function SplitDiffColumn({
  rows,
  side,
  gutterWidth,
  wrapLines,
  textMetricsStyle,
  reviewActions,
  showDivider = false,
  onExpandContext,
  lineReview,
  navigation,
}: {
  rows: SplitDiffRow[];
  side: "left" | "right";
  gutterWidth: number;
  wrapLines: boolean;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  showDivider?: boolean;
  onExpandContext?: (region: DiffContextRegion, direction: "up" | "down" | "all") => void;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const [scrollWidth, setScrollWidth] = useState(0);
  const [hoveredReviewTargetKey, setHoveredReviewTargetKey] = useState<string | null>(null);
  const contextControlRowHeight = Math.max(
    DIFF_CONTEXT_CONTROL_HEIGHT,
    getNumericLineHeight(textMetricsStyle) ?? 0,
  );

  const wrapCellStyle = useMemo(
    () => [styles.splitCell, showDivider && styles.splitCellWithDivider],
    [showDivider],
  );
  const rowCellStyle = useMemo(
    () => [styles.splitCell, showDivider && styles.splitCellWithDivider, styles.splitCellRow],
    [showDivider],
  );
  const linesContainerRowStyle = useMemo(
    () => [
      styles.linesContainer,
      scrollWidth > 0 && inlineUnistylesStyle({ minWidth: scrollWidth }),
    ],
    [scrollWidth],
  );
  const headerLineTextStyle = useMemo(
    () => [styles.diffTextMetrics, textMetricsStyle, styles.diffLineText, styles.headerLineText],
    [textMetricsStyle],
  );

  const keyedRows = useMemo(() => rows.map((row, i) => ({ key: `row-${i}`, row })), [rows]);

  if (wrapLines) {
    return (
      <View style={wrapCellStyle} testID={`diff-${side}-column`}>
        <View style={styles.linesContainer}>
          {keyedRows.map(({ key, row }) => {
            if (row.kind === "header") {
              return (
                <View
                  key={key}
                  style={[
                    styles.splitHeaderRow,
                    parseDiffContextMarker(row.content) &&
                      inlineUnistylesStyle({
                        minHeight: contextControlRowHeight,
                      }),
                  ]}
                >
                  <SplitHeaderContent
                    content={row.content}
                    side={side}
                    textStyle={headerLineTextStyle}
                    onExpandContext={onExpandContext}
                  />
                </View>
              );
            }
            const line = side === "left" ? row.left : row.right;
            const reviewRowState = getSplitInlineReviewThreadState({
              left: row.left?.reviewTarget,
              right: row.right?.reviewTarget,
              reviewActions,
            });
            return (
              <View key={key}>
                <SplitDiffLine
                  line={line}
                  gutterWidth={gutterWidth}
                  wrapLines={wrapLines}
                  textMetricsStyle={textMetricsStyle}
                  reviewActions={reviewActions}
                  lineReview={lineReview}
                  navigation={navigation}
                />
                <InlineReviewRow
                  reviewTarget={line?.reviewTarget}
                  reviewActions={reviewActions}
                  gutterWidth={gutterWidth}
                  reservedHeight={reviewRowState?.height}
                />
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={rowCellStyle} testID={`diff-${side}-column`}>
      <View style={styles.gutterColumn}>
        {keyedRows.map(({ key, row }) => {
          if (row.kind === "header") {
            return (
              <DiffGutterCell
                key={key}
                lineNumber={null}
                type="header"
                gutterWidth={gutterWidth}
                textMetricsStyle={textMetricsStyle}
                lineReview={lineReview}
                navigation={navigation}
                testID={`diff-${side}-gutter-cell-${key}`}
                rowHeight={
                  parseDiffContextMarker(row.content) ? contextControlRowHeight : undefined
                }
              />
            );
          }
          const line = side === "left" ? row.left : row.right;
          const reviewTargetKey = line?.reviewTarget?.key ?? null;
          const reviewRowState = getSplitInlineReviewThreadState({
            left: row.left?.reviewTarget,
            right: row.right?.reviewTarget,
            reviewActions,
          });
          return (
            <View key={key}>
              <DiffGutterCell
                lineNumber={line?.lineNumber ?? null}
                type={line?.type}
                gutterWidth={gutterWidth}
                textMetricsStyle={textMetricsStyle}
                reviewTarget={line?.reviewTarget}
                reviewActions={reviewActions}
                isLineHovered={
                  reviewTargetKey !== null && hoveredReviewTargetKey === reviewTargetKey
                }
                lineReview={lineReview}
                navigation={navigation}
                testID={`diff-${side}-gutter-cell-${key}`}
              />
              <InlineReviewGutterSpacer
                reviewTarget={line?.reviewTarget}
                reviewActions={reviewActions}
                gutterWidth={gutterWidth}
                reservedHeight={reviewRowState?.height}
              />
            </View>
          );
        })}
      </View>
      <DiffScroll
        scrollViewWidth={scrollWidth}
        onScrollViewWidthChange={setScrollWidth}
        style={styles.splitColumnScroll}
        contentContainerStyle={styles.diffContentInner}
        testID="diff-horizontal-scroll"
      >
        <View style={linesContainerRowStyle}>
          {keyedRows.map(({ key, row }) => {
            if (row.kind === "header") {
              return (
                <View
                  key={key}
                  style={[
                    styles.splitHeaderRow,
                    parseDiffContextMarker(row.content) &&
                      inlineUnistylesStyle({
                        minHeight: contextControlRowHeight,
                      }),
                  ]}
                >
                  <SplitHeaderContent
                    content={row.content}
                    side={side}
                    textStyle={headerLineTextStyle}
                    onExpandContext={onExpandContext}
                  />
                </View>
              );
            }
            const line = side === "left" ? row.left : row.right;
            const reviewTargetKey = line?.reviewTarget?.key ?? null;
            const reviewRowState = getSplitInlineReviewThreadState({
              left: row.left?.reviewTarget,
              right: row.right?.reviewTarget,
              reviewActions,
            });
            return (
              <View key={key}>
                <SplitTextLine
                  line={line}
                  wrapLines={false}
                  textMetricsStyle={textMetricsStyle}
                  reviewActions={reviewActions}
                  hoverTargetKey={reviewTargetKey}
                  onHoverTargetChange={setHoveredReviewTargetKey}
                  lineReview={lineReview}
                  navigation={navigation}
                />
                <InlineReviewThreadContent
                  reviewTarget={line?.reviewTarget}
                  reviewActions={reviewActions}
                  reservedHeight={reviewRowState?.height}
                  viewportWidth={scrollWidth}
                  pinToViewport
                />
              </View>
            );
          })}
        </View>
      </DiffScroll>
    </View>
  );
}

function DiffFileActionsContextMenuContent({
  file,
  onOpenFile,
  onAddToChat,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDownload,
  onDuplicate,
  onRevert,
  testID,
}: Pick<
  DiffFileSectionProps,
  | "file"
  | "onOpenFile"
  | "onAddToChat"
  | "onCopyPath"
  | "onCopyRelativePath"
  | "onReveal"
  | "revealTargetName"
  | "onDownload"
  | "onDuplicate"
  | "onRevert"
  | "testID"
>) {
  const handleOpenFile = useCallback(() => onOpenFile?.(file.path), [file.path, onOpenFile]);
  const handleAddToChat = useCallback(() => onAddToChat?.(file.path), [file.path, onAddToChat]);
  const handleCopyPath = useCallback(() => onCopyPath?.(file.path), [file.path, onCopyPath]);
  const handleCopyRelativePath = useCallback(
    () => onCopyRelativePath?.(file.path),
    [file.path, onCopyRelativePath],
  );
  const handleReveal = useCallback(() => onReveal?.(file.path), [file.path, onReveal]);
  const handleDownload = useCallback(() => onDownload?.(file.path), [file.path, onDownload]);
  const handleDuplicate = useCallback(() => onDuplicate?.(file.path), [file.path, onDuplicate]);
  const handleRevert = useCallback(
    () => onRevert?.(file.path, file.oldPath),
    [file.oldPath, file.path, onRevert],
  );

  return (
    <FileActionsContextMenuContent
      fileKind="file"
      fileExists={!file.isDeleted}
      onOpenFile={onOpenFile ? handleOpenFile : undefined}
      onCopyPath={onCopyPath ? handleCopyPath : undefined}
      onCopyRelativePath={onCopyRelativePath ? handleCopyRelativePath : undefined}
      onReveal={onReveal ? handleReveal : undefined}
      revealTargetName={revealTargetName}
      onDownload={onDownload ? handleDownload : undefined}
      onAddToChat={onAddToChat ? handleAddToChat : undefined}
      onDuplicate={!file.isDeleted && onDuplicate ? handleDuplicate : undefined}
      onRevert={onRevert ? handleRevert : undefined}
      testIDPrefix={testID}
    />
  );
}

function DiffFileReviewToggle({
  file,
  fileName,
  fileReviews,
  testID,
  onToggleReviewed,
}: {
  file: ParsedDiffFile;
  fileName: string;
  fileReviews?: FileReviewActions;
  testID?: string;
  onToggleReviewed?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const isReviewed = fileReviews?.reviewedPaths.has(file.path) === true;
  const progress = fileReviews?.lineProgressByPath.get(file.path);
  const isPartial = Boolean(
    progress && progress.reviewed > 0 && progress.reviewed < progress.total,
  );
  const accessibilityState = useMemo(
    () => ({ checked: isPartial ? ("mixed" as const) : isReviewed }),
    [isPartial, isReviewed],
  );
  const toggleReviewed = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onToggleReviewed?.(file.path);
    },
    [file.path, onToggleReviewed],
  );
  if (!fileReviews?.available || !file.contentRevision) return null;

  const actionLabel = isReviewed
    ? t("workspace.git.diff.markUnreviewed")
    : t("workspace.git.diff.markReviewed");
  let reviewIcon: ReactNode = <ThemedSquare size={16} uniProps={foregroundMutedIconColorMapping} />;
  if (isReviewed) {
    reviewIcon = <ThemedSquareCheckBig size={16} uniProps={reviewedIconColorMapping} />;
  } else if (isPartial) {
    reviewIcon = <ThemedListChecks size={16} uniProps={foregroundMutedIconColorMapping} />;
  }
  return (
    <View style={styles.fileReviewControl}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={accessibilityState}
            accessibilityLabel={
              isReviewed
                ? t("workspace.git.diff.markFileUnreviewed", { file: fileName })
                : t("workspace.git.diff.markFileReviewed", { file: fileName })
            }
            testID={testID ? `${testID}-reviewed` : undefined}
            style={styles.fileReviewButton}
            onPress={toggleReviewed}
          >
            {reviewIcon}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{actionLabel}</Text>
        </TooltipContent>
      </Tooltip>
      {progress && progress.total > 0 ? (
        <Text style={styles.fileReviewProgress}>
          {progress.reviewed}/{progress.total}
        </Text>
      ) : null}
    </View>
  );
}

const DiffFileHeader = memo(function DiffFileHeader({
  file,
  workspaceFileDragScope,
  isExpanded,
  isSelected = false,
  depth = 0,
  showDir = true,
  interactive = true,
  onToggle,
  onSelect,
  onOpenFile,
  onAddToChat,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDownload,
  onDuplicate,
  onRevert,
  onHeaderHeightChange,
  fileReviews,
  onToggleReviewed,
  onExpandFile,
  isExpandingFile = false,
  lsp,
  testID,
}: DiffFileSectionProps) {
  const dragSourceRef = useWorkspaceFileDragSource({
    enabled: interactive,
    disabled: file.isDeleted,
    workspaceId: null,
    path: file.path,
    ...workspaceFileDragScope,
  });
  const layoutYRef = useRef<number | null>(null);
  const pressHandledRef = useRef(false);
  const pressInRef = useRef<{
    ts: number;
    pageX: number;
    pageY: number;
  } | null>(null);

  const handleSelect = useCallback(() => {
    if (interactive) {
      onSelect?.(file.path);
    }
  }, [file.path, interactive, onSelect]);

  const toggleExpanded = useCallback(() => {
    if (!interactive) {
      return;
    }
    const selection = isWeb ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().length > 0) {
      return;
    }
    pressHandledRef.current = true;
    handleSelect();
    onToggle?.(file.path);
  }, [file.path, handleSelect, interactive, onToggle]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      layoutYRef.current = event.nativeEvent.layout.y;
      onHeaderHeightChange?.(file.path, event.nativeEvent.layout.height);
    },
    [file.path, onHeaderHeightChange],
  );

  const handlePressIn = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    pressHandledRef.current = false;
    pressInRef.current = {
      ts: Date.now(),
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    };
  }, []);

  const handleLongPress = useCallback(() => {
    pressHandledRef.current = true;
    handleSelect();
  }, [handleSelect]);

  const handlePressOut = useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      if (
        interactive &&
        isNative &&
        !pressHandledRef.current &&
        layoutYRef.current === 0 &&
        pressInRef.current
      ) {
        const durationMs = Date.now() - pressInRef.current.ts;
        const dx = event.nativeEvent.pageX - pressInRef.current.pageX;
        const dy = event.nativeEvent.pageY - pressInRef.current.pageY;
        const distance = Math.hypot(dx, dy);
        if (durationMs <= 500 && distance <= 12) {
          toggleExpanded();
        }
      }
    },
    [interactive, toggleExpanded],
  );

  const containerStyle = useMemo(
    () => [styles.fileSectionHeaderContainer, isExpanded && styles.fileSectionHeaderExpanded],
    [isExpanded],
  );
  const accessibilityState = useMemo(
    () => ({ expanded: isExpanded, selected: isSelected }),
    [isExpanded, isSelected],
  );

  const headerPressableStyle = useCallback(
    (state: PressableStateCallbackType) =>
      depth > 0
        ? [
            fileHeaderPressableStyle(state, isSelected),
            inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(depth) }),
          ]
        : fileHeaderPressableStyle(state, isSelected),
    [depth, isSelected],
  );

  const fileName = file.path.split("/").pop() ?? file.path;
  const headerContent = (
    <>
      <View
        ref={dragSourceRef}
        style={showDir ? styles.fileHeaderLeft : [styles.fileHeaderLeft, styles.fileHeaderLeftTree]}
      >
        {showDir ? null : (
          <View style={styles.fileIcon} testID={testID ? `${testID}-icon` : undefined}>
            <MaterialFileIcon fileName={fileName} size={WORKSPACE_TREE_ICON_SIZE} />
          </View>
        )}
        <Text style={styles.fileName} numberOfLines={1}>
          {fileName}
        </Text>
        {showDir ? (
          <Text style={styles.fileDir} numberOfLines={1}>
            {file.path.includes("/") ? ` ${file.path.slice(0, file.path.lastIndexOf("/"))}` : ""}
          </Text>
        ) : (
          // Flex spacer in tree mode (no dir suffix) so the New/Deleted badge
          // stays right-aligned next to the diff stats, as in the flat list.
          <View style={styles.fileDirSpacer} />
        )}
        {file.isNew && <FileChangeIcon change="added" />}
        {file.isDeleted && <FileChangeIcon change="deleted" />}
      </View>
      <View style={styles.fileHeaderRight}>
        {lsp?.supported ? <ChangesFileLspStatus file={file} lsp={lsp} /> : null}
        <DiffFileExpandButton
          file={file}
          isExpanding={isExpandingFile}
          onExpand={onExpandFile}
          testID={testID}
        />
        <DiffFileReviewToggle
          file={file}
          fileName={fileName}
          fileReviews={fileReviews}
          testID={testID}
          onToggleReviewed={onToggleReviewed}
        />
        <DiffStat
          additions={file.additions}
          deletions={file.deletions}
          testID={testID ? `${testID}-stat` : undefined}
        />
      </View>
    </>
  );

  let trigger: ReactElement;
  if (!interactive) {
    trigger = (
      <View
        {...{
          onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
        }}
        style={headerPressableStyle({ hovered: false, pressed: false })}
      >
        {headerContent}
      </View>
    );
  } else {
    trigger = (
      <ContextMenuTrigger
        testID={testID ? `${testID}-toggle` : undefined}
        style={headerPressableStyle}
        // Android: prevent parent pan/scroll gestures from canceling the tap release.
        cancelable={false}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        onContextMenu={handleSelect}
        onPress={toggleExpanded}
        accessibilityState={accessibilityState}
        aria-selected={isSelected}
      >
        {headerContent}
      </ContextMenuTrigger>
    );
  }

  return (
    <View style={containerStyle} onLayout={handleLayout} testID={testID}>
      <TreeIndentGuides depth={depth} />
      <ContextMenu>
        <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom" align="start" offset={6} maxWidth={520}>
            <Text style={styles.tooltipText}>{file.path}</Text>
          </TooltipContent>
        </Tooltip>
        {interactive ? (
          <DiffFileActionsContextMenuContent
            file={file}
            onOpenFile={onOpenFile}
            onAddToChat={onAddToChat}
            onCopyPath={onCopyPath}
            onCopyRelativePath={onCopyRelativePath}
            onReveal={onReveal}
            revealTargetName={revealTargetName}
            onDownload={onDownload}
            onDuplicate={onDuplicate}
            onRevert={onRevert}
            testID={testID}
          />
        ) : null}
      </ContextMenu>
    </View>
  );
});

function ChangesFileLspStatus({ file, lsp }: { file: ParsedDiffFile; lsp: ChangesLspController }) {
  const language = lspLanguageForFile(file.path);
  const subscribe = useCallback(
    (listener: () => void) => lsp.subscribeFile(file.path, listener),
    [file.path, lsp],
  );
  const getSnapshot = useCallback(() => lsp.getFileSnapshot(file.path), [file.path, lsp]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!language || file.isDeleted || !lsp.supported) return;
    return lsp.acquireVisibleFile(file.path);
  }, [file.isDeleted, file.path, language, lsp]);
  const retry = useCallback(() => lsp.retry(file.path), [file.path, lsp]);
  if (!language || file.isDeleted || !lsp.supported) return null;
  return (
    <LspStatusMenu
      enabled={lsp.preferenceEnabled}
      snapshot={snapshot}
      language={language}
      standaloneClangdSupported={lsp.standaloneClangdSupported}
      pausedReason={
        lsp.pauseReason === "dirty-worktree"
          ? "Language intelligence is paused while this workspace has uncommitted changes. Clean the workspace to resume."
          : null
      }
      onEnabledChange={lsp.setEnabled}
      onRetry={retry}
      testIDPrefix={`changes-lsp-${file.path}`}
    />
  );
}

function DiffFileExpandButton({
  file,
  isExpanding,
  onExpand,
  testID,
}: {
  file: ParsedDiffFile;
  isExpanding: boolean;
  onExpand?: (path: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ disabled: isExpanding }), [isExpanding]);
  const handlePress = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onExpand?.(file.path);
    },
    [file.path, onExpand],
  );
  if (!onExpand || buildDiffContextRegions(file).length === 0) return null;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.git.diff.context.expandFile")}
          accessibilityState={accessibilityState}
          disabled={isExpanding}
          onPress={handlePress}
          style={styles.fileReviewButton}
          testID={testID ? `${testID}-expand-file` : undefined}
        >
          {isExpanding ? (
            <ThemedLoadingSpinner size={14} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedMaximize2 size={14} uniProps={foregroundMutedIconColorMapping} />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{t("workspace.git.diff.context.expandFile")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function DiffFileBody({
  file,
  layout,
  wrapLines,
  codeFontSize,
  textMetricsStyle,
  reviewActions,
  onExpandContext,
  onBodyHeightChange,
  testID,
  lineReview,
  navigation,
}: {
  file: ParsedDiffFile;
  layout: "unified" | "split";
  wrapLines: boolean;
  codeFontSize: number;
  textMetricsStyle: TextStyle;
  reviewActions?: InlineReviewActions;
  onExpandContext?: (
    filePath: string,
    region: DiffContextRegion,
    direction: "up" | "down" | "all",
  ) => void | Promise<void>;
  onBodyHeightChange?: (file: ParsedDiffFile, height: number) => void;
  testID?: string;
  lineReview?: LineReviewPresentation;
  navigation?: DiffNavigationHighlight;
}) {
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [hoveredReviewTargetKey, setHoveredReviewTargetKey] = useState<string | null>(null);
  const { t } = useTranslation();
  const handleExpandContext = useCallback(
    (region: DiffContextRegion, direction: "up" | "down" | "all") =>
      onExpandContext?.(file.path, region, direction),
    [file.path, onExpandContext],
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setBodyWidth(event.nativeEvent.layout.width);
      onBodyHeightChange?.(file, event.nativeEvent.layout.height);
    },
    [file, onBodyHeightChange],
  );

  const availableWidth = bodyWidth > 0 ? bodyWidth : scrollViewWidth;
  const linesContainerRowStyle = useMemo(
    () => [
      styles.linesContainer,
      availableWidth > 0 && inlineUnistylesStyle({ minWidth: availableWidth }),
    ],
    [availableWidth],
  );

  return (
    <View
      style={[styles.fileSectionBodyContainer, styles.fileSectionBorder]}
      onLayout={handleLayout}
      testID={testID}
    >
      {(() => {
        if (file.status === "too_large" || file.status === "binary") {
          return (
            <View style={styles.statusMessageContainer}>
              <Text style={styles.statusMessageText}>
                {file.status === "binary"
                  ? t("workspace.git.diff.binaryFile")
                  : t("workspace.git.diff.tooLarge")}
              </Text>
            </View>
          );
        }

        let maxLineNo = 0;
        for (const hunk of file.hunks) {
          maxLineNo = Math.max(
            maxLineNo,
            hunk.oldStart + hunk.oldCount,
            hunk.newStart + hunk.newCount,
          );
        }
        const gutterWidth =
          lineNumberGutterWidth(maxLineNo, codeFontSize) +
          (lineReview ? LINE_REVIEW_GUTTER_WIDTH : 0);
        const contextControlRowHeight = Math.max(
          DIFF_CONTEXT_CONTROL_HEIGHT,
          getNumericLineHeight(textMetricsStyle) ?? 0,
        );

        if (layout === "split") {
          const rows = buildSplitDiffRows(file);
          return (
            <View style={[styles.diffContent, styles.splitRow]} dataSet={CODE_SURFACE_DATASET}>
              <SplitDiffColumn
                rows={rows}
                side="left"
                gutterWidth={gutterWidth}
                wrapLines={wrapLines}
                textMetricsStyle={textMetricsStyle}
                reviewActions={reviewActions}
                onExpandContext={onExpandContext ? handleExpandContext : undefined}
                lineReview={lineReview}
                navigation={navigation}
              />
              <SplitDiffColumn
                rows={rows}
                side="right"
                gutterWidth={gutterWidth}
                wrapLines={wrapLines}
                textMetricsStyle={textMetricsStyle}
                reviewActions={reviewActions}
                onExpandContext={onExpandContext ? handleExpandContext : undefined}
                showDivider
                lineReview={lineReview}
                navigation={navigation}
              />
            </View>
          );
        }

        const computedLines = buildUnifiedDiffLines(file);

        if (wrapLines) {
          return (
            <View style={styles.diffContent} dataSet={CODE_SURFACE_DATASET}>
              <View style={styles.linesContainer}>
                {computedLines.map(({ line, lineNumber, key, reviewTarget }, index) => (
                  <View key={key} testID={`diff-wrapped-row-${index}`}>
                    <DiffLineView
                      line={line}
                      lineNumber={lineNumber}
                      gutterWidth={gutterWidth}
                      wrapLines={wrapLines}
                      textMetricsStyle={textMetricsStyle}
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      onExpandContext={onExpandContext ? handleExpandContext : undefined}
                      lineReview={lineReview}
                      navigation={navigation}
                    />
                    <InlineReviewRow
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      gutterWidth={gutterWidth}
                    />
                  </View>
                ))}
              </View>
            </View>
          );
        }

        const textViewportWidth =
          scrollViewWidth > 0 ? scrollViewWidth : Math.max(0, bodyWidth - gutterWidth);
        return (
          <View style={[styles.diffContent, styles.diffContentRow]} dataSet={CODE_SURFACE_DATASET}>
            <View style={styles.gutterColumn}>
              {computedLines.map(({ line, lineNumber, key, reviewTarget }, index) => (
                <View key={key} testID={`diff-gutter-row-${index}`}>
                  <DiffGutterCell
                    lineNumber={lineNumber}
                    type={line.type}
                    gutterWidth={gutterWidth}
                    textMetricsStyle={textMetricsStyle}
                    reviewTarget={reviewTarget}
                    reviewActions={reviewActions}
                    isLineHovered={
                      reviewTarget?.key !== undefined && hoveredReviewTargetKey === reviewTarget.key
                    }
                    textTestID={`diff-gutter-text-${index}`}
                    actionTestID={`diff-gutter-action-${index}`}
                    testID={`diff-gutter-cell-${index}`}
                    lineReview={lineReview}
                    navigation={navigation}
                    rowHeight={
                      parseDiffContextMarker(line.content) && onExpandContext
                        ? contextControlRowHeight
                        : undefined
                    }
                  />
                  <InlineReviewGutterSpacer
                    reviewTarget={reviewTarget}
                    reviewActions={reviewActions}
                    gutterWidth={gutterWidth}
                  />
                </View>
              ))}
            </View>
            <DiffScroll
              scrollViewWidth={scrollViewWidth}
              onScrollViewWidthChange={setScrollViewWidth}
              style={styles.splitColumnScroll}
              contentContainerStyle={styles.diffContentInner}
              testID="diff-horizontal-scroll"
            >
              <View style={linesContainerRowStyle}>
                {computedLines.map(({ line, key, reviewTarget }, index) => (
                  <View key={key} testID={`diff-code-row-${index}`}>
                    <DiffTextLine
                      line={line}
                      wrapLines={false}
                      textMetricsStyle={textMetricsStyle}
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      hoverTargetKey={reviewTarget?.key ?? null}
                      onHoverTargetChange={setHoveredReviewTargetKey}
                      textTestID={`diff-code-text-${index}`}
                      onExpandContext={onExpandContext ? handleExpandContext : undefined}
                      lineReview={lineReview}
                      navigation={navigation}
                    />
                    <InlineReviewThreadContent
                      reviewTarget={reviewTarget}
                      reviewActions={reviewActions}
                      viewportWidth={textViewportWidth}
                      pinToViewport
                    />
                  </View>
                ))}
              </View>
            </DiffScroll>
          </View>
        );
      })()}
    </View>
  );
}

interface GitDiffPaneProps {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  enabled?: boolean;
  onOpenFile?: (path: string, options?: { lineStart: number; openMode: "source" }) => void;
  onAddToChat?: (path: string) => void;
}

function useInlineChangesNavigationTarget(): {
  focus: Pick<
    WorkspaceWorkingDiffTabTarget,
    "focusPath" | "focusRequestId" | "focusLineStart" | "focusLineEnd" | "focusColumn"
  >;
  requestedLine: { filePath: string; lineNumber: number } | undefined;
  navigate: (target: WorkspaceWorkingDiffTabTarget) => void;
} {
  const [target, setTarget] = useState<WorkspaceWorkingDiffTabTarget | null>(null);
  const navigate = useCallback((nextTarget: WorkspaceWorkingDiffTabTarget) => {
    setTarget(nextTarget);
  }, []);
  const requestedLine = useMemo(
    () =>
      target?.focusPath && target.focusLineStart
        ? { filePath: target.focusPath, lineNumber: target.focusLineStart }
        : undefined,
    [target?.focusLineStart, target?.focusPath],
  );
  const focus = useMemo(
    () => ({
      focusPath: target?.focusPath,
      focusRequestId: target?.focusRequestId,
      focusLineStart: target?.focusLineStart,
      focusLineEnd: target?.focusLineEnd,
      focusColumn: target?.focusColumn,
    }),
    [target],
  );
  return { focus, requestedLine, navigate };
}

function usePublishInlineChangesNavigation(input: {
  workspaceKey: string | null;
  enabled?: boolean;
  changesTabOpen: boolean;
  files: ParsedDiffFile[];
  isLoading: boolean;
  contextExpansionSupported: boolean;
  navigate: (target: WorkspaceWorkingDiffTabTarget) => void;
}): void {
  const ownerRef = useRef<object>({});
  useEffect(() => {
    if (!input.workspaceKey || input.enabled === false || input.changesTabOpen) {
      return;
    }
    const owner = ownerRef.current;
    const workspaceKey = input.workspaceKey;
    publishInlineWorkingDiffNavigationSnapshot(workspaceKey, owner, {
      files: input.files,
      isLoading: input.isLoading,
      contextExpansionSupported: input.contextExpansionSupported,
      navigate: input.navigate,
    });
    return () => {
      clearInlineWorkingDiffNavigationSnapshot(workspaceKey, owner);
    };
  }, [
    input.changesTabOpen,
    input.contextExpansionSupported,
    input.enabled,
    input.files,
    input.isLoading,
    input.navigate,
    input.workspaceKey,
  ]);
}

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean; open?: boolean },
) => StyleProp<ViewStyle>;

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const reviewedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.success,
});

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedAlignJustify = withUnistyles(AlignJustify);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const ThemedListTodo = withUnistyles(ListTodo);
const ThemedFolderTree = withUnistyles(FolderTree);
const ThemedList = withUnistyles(List);
const ThemedMaximize2 = withUnistyles(Maximize2);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSquare = withUnistyles(Square);
const ThemedSquareCheckBig = withUnistyles(SquareCheckBig);
const ThemedListChecks = withUnistyles(ListChecks);
const DIFF_OPTIONS_WHITESPACE_ICON = (
  <ThemedPilcrow size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_WRAP_ICON = (
  <ThemedWrapText size={14} uniProps={foregroundMutedIconColorMapping} />
);

interface DiffLayoutToggleProps {
  layout: "unified" | "split";
  isMobile: boolean;
  testID?: string;
  toggleStyle?: PressableStyleFn;
  onToggle: () => void;
}

export function DiffLayoutToggle({
  layout,
  isMobile,
  testID = "changes-toggle-layout",
  toggleStyle,
  onToggle,
}: DiffLayoutToggleProps) {
  const defaultToggleStyle = useMemo(
    () => buildToggleButtonStyle(false, styles.expandAllButton),
    [],
  );
  const { t } = useTranslation();
  const label =
    layout === "unified"
      ? t("workspace.git.diff.switchToSplit")
      : t("workspace.git.diff.switchToUnified");
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testID}
          onPress={onToggle}
          style={toggleStyle ?? defaultToggleStyle}
        >
          {layout === "unified" ? (
            <ThemedColumns2 size={isMobile ? 18 : 14} uniProps={foregroundMutedIconColorMapping} />
          ) : (
            <ThemedAlignJustify
              size={isMobile ? 18 : 14}
              uniProps={foregroundMutedIconColorMapping}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface ChangesTabToggleProps {
  isMobile: boolean;
  selected: boolean;
  onPress: () => void;
}

interface DiffModeMenuProps {
  diffMode: "uncommitted" | "base";
  committedDescription?: string;
  testIDPrefix?: string;
  onSelectUncommitted: () => void;
  onSelectBase: () => void;
}

export function DiffModeMenu({
  diffMode,
  committedDescription,
  testIDPrefix = "changes-diff",
  onSelectUncommitted,
  onSelectBase,
}: DiffModeMenuProps) {
  const { t } = useTranslation();
  const triggerStyle = useMemo(() => buildDiffModeTriggerStyle(), []);
  const uncommittedLabel = t("workspace.git.diff.uncommitted");
  const committedLabel = t("workspace.git.diff.committed");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID={`${testIDPrefix}-status-trigger`}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.diffMode")}
      >
        <Text style={styles.diffStatusText} numberOfLines={1}>
          {diffMode === "uncommitted" ? uncommittedLabel : committedLabel}
        </Text>
        <ThemedChevronDown size={12} uniProps={foregroundMutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={260} testID={`${testIDPrefix}-status-menu`}>
        <DropdownMenuItem
          testID={`${testIDPrefix}-mode-uncommitted`}
          selected={diffMode === "uncommitted"}
          onSelect={onSelectUncommitted}
        >
          {uncommittedLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          testID={`${testIDPrefix}-mode-committed`}
          selected={diffMode === "base"}
          description={committedDescription}
          onSelect={onSelectBase}
        >
          {committedLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChangesTabToggle({ isMobile, selected, onPress }: ChangesTabToggleProps) {
  const { t } = useTranslation();
  const buttonStyle = useMemo(
    () => buildToggleButtonStyle(selected, styles.expandAllButton),
    [selected],
  );
  const label = t(
    selected ? "workspace.git.diff.closeChangesTab" : "workspace.git.diff.openChangesTab",
  );
  if (isMobile) {
    return null;
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID="changes-open-tab"
          onPress={onPress}
          style={buttonStyle}
        >
          <ThemedMaximize2 size={14} uniProps={foregroundMutedIconColorMapping} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface DiffViewModeToggleProps {
  viewMode: "flat" | "tree";
  isMobile: boolean;
  toggleStyle: PressableStyleFn;
  onToggle: () => void;
}

function DiffViewModeToggle({
  viewMode,
  isMobile,
  toggleStyle,
  onToggle,
}: DiffViewModeToggleProps) {
  const { t } = useTranslation();
  const label =
    viewMode === "flat"
      ? t("workspace.git.diff.showTreeView")
      : t("workspace.git.diff.showFlatView");
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID="changes-toggle-view-mode"
          style={toggleStyle}
          onPress={onToggle}
        >
          {viewMode === "flat" ? (
            <ThemedFolderTree
              size={isMobile ? 18 : 14}
              uniProps={foregroundMutedIconColorMapping}
            />
          ) : (
            <ThemedList size={isMobile ? 18 : 14} uniProps={foregroundMutedIconColorMapping} />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface DiffFilesToolbarProps {
  allFileDiffsExpanded: boolean;
  canExpandUnreviewed: boolean;
  isMobile: boolean;
  testID?: string;
  expandUnreviewedTestID?: string;
  expandAllToggleStyle?: PressableStyleFn;
  onToggleExpandAll: () => void;
  onExpandUnreviewed: () => void;
}

export function DiffFilesToolbar({
  allFileDiffsExpanded,
  canExpandUnreviewed,
  isMobile,
  testID,
  expandUnreviewedTestID,
  expandAllToggleStyle,
  onToggleExpandAll,
  onExpandUnreviewed,
}: DiffFilesToolbarProps) {
  const defaultToggleStyle = useMemo(() => buildExpandAllButtonStyle(), []);
  const { t } = useTranslation();
  const expandUnreviewedLabel = t("workspace.git.diff.expandUnreviewed");
  const expandAllLabel = allFileDiffsExpanded
    ? t("workspace.git.diff.collapseAll")
    : t("workspace.git.diff.expandAll");
  return (
    <View style={styles.diffStatusButtons}>
      {canExpandUnreviewed ? (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expandUnreviewedLabel}
              testID={expandUnreviewedTestID}
              style={expandAllToggleStyle ?? defaultToggleStyle}
              onPress={onExpandUnreviewed}
            >
              <ThemedListTodo
                size={isMobile ? 18 : 14}
                uniProps={foregroundMutedIconColorMapping}
              />
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Text style={styles.tooltipText}>{expandUnreviewedLabel}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expandAllLabel}
            testID={testID}
            style={expandAllToggleStyle ?? defaultToggleStyle}
            onPress={onToggleExpandAll}
          >
            {allFileDiffsExpanded ? (
              <ThemedListChevronsDownUp
                size={isMobile ? 18 : 14}
                uniProps={foregroundMutedIconColorMapping}
              />
            ) : (
              <ThemedListChevronsUpDown
                size={isMobile ? 18 : 14}
                uniProps={foregroundMutedIconColorMapping}
              />
            )}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{expandAllLabel}</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

export function FileReviewBulkToggle({
  fileReviews,
  isMobile,
  visible = true,
  testID,
  onToggle,
}: {
  fileReviews: FileReviewActions;
  isMobile: boolean;
  visible?: boolean;
  testID?: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const allReviewed =
    fileReviews.reviewableCount > 0 && fileReviews.reviewedCount === fileReviews.reviewableCount;
  const disabled = !fileReviews.available || fileReviews.reviewableCount === 0;
  let label = allReviewed
    ? t("workspace.git.diff.clearAllReviewed")
    : t("workspace.git.diff.markAllReviewed");
  if (!fileReviews.supported) label = t("workspace.git.diff.reviewUpdateHost");
  else if (!fileReviews.available) label = t("workspace.git.diff.reviewBranchRequired");
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const toggleStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.expandAllButton,
      (Boolean(hovered) || pressed || allReviewed) && styles.toggleButtonSelected,
      disabled && styles.fileReviewButtonDisabled,
    ],
    [allReviewed, disabled],
  );
  if (!visible) return null;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={accessibilityState}
          disabled={disabled}
          testID={testID}
          style={toggleStyle}
          onPress={onToggle}
        >
          <ThemedListChecks
            size={isMobile ? 18 : 14}
            uniProps={allReviewed ? reviewedIconColorMapping : foregroundMutedIconColorMapping}
          />
          {fileReviews.supported && fileReviews.available ? (
            <Text style={styles.fileReviewProgress}>
              {fileReviews.reviewedLineCount}/{fileReviews.reviewableLineCount} ·{" "}
              {fileReviews.reviewedCount}/{fileReviews.reviewableCount}
            </Text>
          ) : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface DiffOptionsMenuProps {
  brand?: string;
  hideWhitespace: boolean;
  isMobile: boolean;
  isRefreshing?: boolean;
  overflowToggleStyle?: PressableStyleFn;
  refreshSupported?: boolean;
  testIDPrefix?: string;
  wrapLines: boolean;
  lspSupported?: boolean;
  lspEnabled?: boolean;
  lspPaused?: boolean;
  onRefresh?: () => void;
  onToggleHideWhitespace: () => void;
  onToggleWrapLines: () => void;
  onToggleLsp?: () => void;
}

export function DiffOptionsMenu({
  brand,
  hideWhitespace,
  isMobile,
  isRefreshing = false,
  overflowToggleStyle,
  refreshSupported = false,
  testIDPrefix = "changes",
  wrapLines,
  lspSupported,
  lspEnabled = false,
  lspPaused = false,
  onRefresh,
  onToggleHideWhitespace,
  onToggleWrapLines,
  onToggleLsp,
}: DiffOptionsMenuProps) {
  const { t } = useTranslation();
  const defaultToggleStyle = useMemo(() => buildOverflowButtonStyle(), []);
  const whitespaceLabel = hideWhitespace
    ? t("workspace.git.diff.showWhitespace")
    : t("workspace.git.diff.hideWhitespace");
  const wrapLinesLabel = wrapLines
    ? t("workspace.git.diff.scrollLongLines")
    : t("workspace.git.diff.wrapLongLines");
  const optionsLabel = t("workspace.git.diff.options");
  let lspLabel = t("workspace.git.diff.lspUpdateHost");
  if (lspPaused) lspLabel = "LSP paused — clean the workspace to resume";
  else if (lspSupported) lspLabel = t("workspace.git.diff.lsp");
  let refreshLabel = t("workspace.git.diff.refresh");
  if (isRefreshing) {
    refreshLabel = t("workspace.git.diff.refreshing");
  } else if (brand) {
    refreshLabel = t("workspace.git.diff.refreshState", { brand });
  }
  const refreshIcon = useMemo(
    () =>
      isRefreshing ? (
        <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedIconColorMapping} />
      ) : (
        <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundMutedIconColorMapping} />
      ),
    [isRefreshing],
  );

  return (
    <DropdownMenu>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={optionsLabel}
            testID={`${testIDPrefix}-options-menu`}
            style={overflowToggleStyle ?? defaultToggleStyle}
          >
            <ThemedChevronDown
              size={isMobile ? 18 : 14}
              uniProps={foregroundMutedIconColorMapping}
            />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{optionsLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" width={240} testID={`${testIDPrefix}-options-menu-content`}>
        <DropdownMenuItem
          leading={DIFF_OPTIONS_WHITESPACE_ICON}
          selected={hideWhitespace}
          testID={`${testIDPrefix}-toggle-whitespace`}
          onSelect={onToggleHideWhitespace}
        >
          {whitespaceLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={DIFF_OPTIONS_WRAP_ICON}
          selected={wrapLines}
          testID={`${testIDPrefix}-toggle-wrap-lines`}
          onSelect={onToggleWrapLines}
        >
          {wrapLinesLabel}
        </DropdownMenuItem>
        {onToggleLsp ? (
          <DropdownMenuItem
            disabled={!lspSupported || lspPaused}
            selected={lspEnabled}
            testID={`${testIDPrefix}-toggle-lsp`}
            onSelect={onToggleLsp}
          >
            {lspLabel}
          </DropdownMenuItem>
        ) : null}
        {refreshSupported && onRefresh ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              leading={refreshIcon}
              disabled={isRefreshing}
              testID={`${testIDPrefix}-refresh`}
              onSelect={onRefresh}
            >
              {refreshLabel}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ThemedRotateCw = withUnistyles(RotateCw);

type DiffFlatItemLayoutGetter = NonNullable<FlatListProps<DiffFlatItem>["getItemLayout"]>;
const EMPTY_PATH_LIST: string[] = [];

interface DiffFileMetrics {
  contentLength: number;
  splitLineCount?: number;
  unifiedLineCount: number;
}

const diffFileMetricsCache = new WeakMap<ParsedDiffFile, DiffFileMetrics>();

function getDiffFileMetrics(file: ParsedDiffFile): DiffFileMetrics {
  const cached = diffFileMetricsCache.get(file);
  if (cached) {
    return cached;
  }
  let contentLength = 0;
  let unifiedLineCount = 0;
  for (const hunk of file.hunks) {
    unifiedLineCount += hunk.lines.length;
    for (const line of hunk.lines) {
      contentLength += line.content.length;
    }
  }
  const metrics = { contentLength, unifiedLineCount };
  diffFileMetricsCache.set(file, metrics);
  return metrics;
}

function getSplitDiffLineCount(file: ParsedDiffFile): number {
  const metrics = getDiffFileMetrics(file);
  if (metrics.splitLineCount === undefined) {
    metrics.splitLineCount = buildSplitDiffRows(file).length;
  }
  return metrics.splitLineCount;
}

function revealDiffNavigationColumn(
  element: HTMLElement,
  column: number,
  codeFontSize: number,
  verticalScrollElement: HTMLElement,
): boolean {
  const horizontalViewport = element.closest<HTMLElement>('[data-testid="diff-horizontal-scroll"]');
  if (
    !horizontalViewport ||
    horizontalViewport === verticalScrollElement ||
    horizontalViewport.scrollWidth <= horizontalViewport.clientWidth + 1
  ) {
    return false;
  }
  const approximateCharacterWidth = Math.max(1, codeFontSize * 0.6);
  const columnOffset = Math.max(0, column - 1) * approximateCharacterWidth;
  horizontalViewport.scrollLeft = Math.max(
    0,
    Math.min(
      columnOffset - horizontalViewport.clientWidth * 0.25,
      horizontalViewport.scrollWidth - horizontalViewport.clientWidth,
    ),
  );
  return true;
}

function computeEmptyMessage(
  hideWhitespace: boolean,
  diffMode: "uncommitted" | "base",
  baseRefLabel: string,
  labels: {
    hiddenWhitespace: string;
    uncommitted: string;
    againstBase: (baseRefLabel: string) => string;
  },
): string {
  if (hideWhitespace) {
    return labels.hiddenWhitespace;
  }
  if (diffMode === "uncommitted") {
    return labels.uncommitted;
  }
  return labels.againstBase(baseRefLabel);
}

function resolveEditLineHandler(
  openFile: GitDiffPaneProps["onOpenFile"],
  supported: boolean,
  handler: (line: ReviewableChangedLine) => void,
) {
  return openFile && supported ? handler : undefined;
}

interface DiffBodyContentProps {
  isStatusLoading: boolean;
  statusErrorMessage: string | null;
  notGit: boolean;
  isDiffLoading: boolean;
  diffErrorMessage: string | null;
  diffTooLarge: boolean;
  hasChanges: boolean;
  emptyMessage: string;
  children: ReactElement;
  checkingRepositoryLabel: string;
  notRepositoryLabel: string;
}

function DiffBodyContent({
  isStatusLoading,
  statusErrorMessage,
  notGit,
  isDiffLoading,
  diffErrorMessage,
  diffTooLarge,
  hasChanges,
  emptyMessage,
  children,
  checkingRepositoryLabel,
  notRepositoryLabel,
}: DiffBodyContentProps) {
  if (isStatusLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.loadingText}>{checkingRepositoryLabel}</Text>
      </View>
    );
  }
  if (statusErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{statusErrorMessage}</Text>
      </View>
    );
  }
  if (notGit) {
    return (
      <View style={styles.emptyContainer} testID="changes-not-git">
        <Text style={styles.emptyText}>{notRepositoryLabel}</Text>
      </View>
    );
  }
  if (isDiffLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedIconColorMapping} />
      </View>
    );
  }
  if (diffTooLarge) {
    return <DiffTooLargeState />;
  }
  if (diffErrorMessage) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{diffErrorMessage}</Text>
      </View>
    );
  }
  if (!hasChanges) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }
  return children;
}

interface SharedDiffViewProps {
  files: ParsedDiffFile[];
  displayPreferences: {
    layout: "unified" | "split";
    wrapLines: boolean;
    codeFontSize: number;
    monoFontFamily: string;
  };
  mode:
    | {
        kind: "working_tree";
        viewMode: "flat" | "tree";
        expandedPaths: string[];
        collapsedFolders: string[];
        reviewActions?: InlineReviewActions;
        fileReviews: FileReviewActions;
        onFilePress?: (path: string) => void;
        workspaceFileDragScope?: { serverId: string; workspaceId: string };
        onOpenFile?: (path: string) => void;
        onAddToChat?: (path: string) => void;
        onCopyPath?: (path: string) => void;
        onCopyRelativePath?: (path: string) => void;
        onReveal?: (path: string) => void;
        revealTargetName?: string;
        onDownload?: (path: string) => void;
        onDuplicate?: (path: string) => void;
        onRevert?: (path: string, oldPath?: string) => void;
        onEditLine?: (line: ReviewableChangedLine) => void;
        onExpandContext?: (
          filePath: string,
          region: DiffContextRegion,
          direction: "up" | "down" | "all",
        ) => void | Promise<void>;
        onExpandFile?: (filePath: string) => void | Promise<void>;
        expandingFilePaths?: readonly string[];
        onSearch?: (query: string) => Promise<ChangesSearchResult>;
        lsp?: ChangesLspController;
        onExpandedPathsChange: (paths: string[]) => void;
        onCollapsedFoldersChange: (paths: string[]) => void;
        keyboardEnabled?: boolean;
        focusShortcutEnabled?: boolean;
        onActivate?: () => void;
        focusPath?: string;
        focusRequestId?: number;
        focusLineStart?: number;
        focusLineEnd?: number;
        focusColumn?: number;
      }
    | {
        kind: "working_tab";
        expandedPaths: string[] | null;
        reviewActions: InlineReviewActions;
        fileReviews: FileReviewActions;
        focusPath?: string;
        focusRequestId?: number;
        focusLineStart?: number;
        focusLineEnd?: number;
        focusColumn?: number;
        onExpandedPathsChange: (paths: string[]) => void;
        onEditLine?: (line: ReviewableChangedLine) => void;
        keyboardEnabled?: boolean;
        focusShortcutEnabled?: boolean;
        onActivate?: () => void;
        onExpandContext?: (
          filePath: string,
          region: DiffContextRegion,
          direction: "up" | "down" | "all",
        ) => void | Promise<void>;
        onExpandFile?: (filePath: string) => void | Promise<void>;
        expandingFilePaths?: readonly string[];
        onSearch?: (query: string) => Promise<ChangesSearchResult>;
        lsp?: ChangesLspController;
      }
    | {
        kind: "commit";
      };
}

function resolveSharedDiffMode(
  mode: SharedDiffViewProps["mode"],
  files: readonly ParsedDiffFile[],
) {
  if (mode.kind === "commit") {
    return {
      kind: mode.kind,
      viewMode: "flat" as const,
      expandedPathsArray: files.map((file) => file.path),
      collapsedFoldersArray: EMPTY_PATH_LIST,
      stickyHeaders: false,
      interactive: false,
      reviewActions: undefined,
      fileReviews: undefined,
      onFilePress: undefined,
      focusPath: undefined,
      focusRequestId: undefined,
      focusLineStart: undefined,
      focusLineEnd: undefined,
      focusColumn: undefined,
      onOpenFile: undefined,
      onAddToChat: undefined,
      workspaceFileDragScope: undefined,
      onCopyPath: undefined,
      onDownload: undefined,
      onEditLine: undefined,
      keyboardEnabled: false,
      focusShortcutEnabled: false,
      onExpandContext: undefined,
      onExpandFile: undefined,
      onSearch: undefined,
      changesLsp: undefined,
      expandingFilePathsArray: EMPTY_PATH_LIST,
      onActivate: undefined,
    };
  }
  const common = {
    kind: mode.kind,
    stickyHeaders: true,
    interactive: true,
    reviewActions: mode.reviewActions,
    fileReviews: mode.fileReviews,
    focusPath: mode.focusPath,
    focusRequestId: mode.focusRequestId,
    focusLineStart: mode.focusLineStart,
    focusLineEnd: mode.focusLineEnd,
    focusColumn: mode.focusColumn,
    onEditLine: mode.onEditLine,
    keyboardEnabled: mode.keyboardEnabled !== false,
    focusShortcutEnabled: mode.focusShortcutEnabled !== false,
    onExpandContext: mode.onExpandContext,
    onExpandFile: mode.onExpandFile,
    onSearch: mode.onSearch,
    changesLsp: mode.lsp,
    expandingFilePathsArray: mode.expandingFilePaths ?? EMPTY_PATH_LIST,
    onActivate: mode.onActivate,
  };
  if (mode.kind === "working_tree") {
    return {
      ...common,
      viewMode: mode.viewMode,
      expandedPathsArray: mode.expandedPaths,
      collapsedFoldersArray: mode.collapsedFolders,
      onFilePress: mode.onFilePress,
      onOpenFile: mode.onOpenFile,
      onAddToChat: mode.onAddToChat,
      workspaceFileDragScope: mode.workspaceFileDragScope,
      onCopyPath: mode.onCopyPath,
      onDownload: mode.onDownload,
    };
  }
  return {
    ...common,
    viewMode: "flat" as const,
    expandedPathsArray: mode.expandedPaths ?? files.map((file) => file.path),
    collapsedFoldersArray: EMPTY_PATH_LIST,
    onFilePress: undefined,
    onOpenFile: undefined,
    onAddToChat: undefined,
    workspaceFileDragScope: undefined,
    onCopyPath: undefined,
    onDownload: undefined,
  };
}

export function SharedDiffView({ files, displayPreferences, mode }: SharedDiffViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const { layout, wrapLines, codeFontSize, monoFontFamily } = displayPreferences;
  const diffBodyLineHeight = Math.round(codeFontSize * 1.5);
  const typographyKey = [monoFontFamily, codeFontSize, diffBodyLineHeight].join(":");
  const textMetricsStyle = useMemo<TextStyle>(() => {
    const trimmedMonoFontFamily = monoFontFamily.trim();
    return {
      fontSize: codeFontSize,
      lineHeight: diffBodyLineHeight,
      ...(trimmedMonoFontFamily ? { fontFamily: trimmedMonoFontFamily } : null),
    };
  }, [codeFontSize, diffBodyLineHeight, monoFontFamily]);
  const resolvedMode = useMemo(() => resolveSharedDiffMode(mode, files), [files, mode]);
  const {
    viewMode,
    expandedPathsArray,
    collapsedFoldersArray,
    stickyHeaders,
    interactive,
    reviewActions,
    fileReviews,
    onFilePress,
    focusPath,
    focusRequestId,
    focusLineStart,
    focusLineEnd,
    focusColumn,
    onOpenFile,
    onAddToChat,
    workspaceFileDragScope,
    onCopyPath,
    onDownload,
    onEditLine,
    keyboardEnabled,
    focusShortcutEnabled,
    onExpandContext,
    onExpandFile,
    onSearch,
    changesLsp,
    expandingFilePathsArray,
    onActivate,
  } = resolvedMode;
  const expandedPaths = useMemo(() => new Set(expandedPathsArray), [expandedPathsArray]);
  const collapsedFolders = useMemo(() => new Set(collapsedFoldersArray), [collapsedFoldersArray]);
  const onCopyRelativePath = mode.kind === "working_tree" ? mode.onCopyRelativePath : undefined;
  const onReveal = mode.kind === "working_tree" ? mode.onReveal : undefined;
  const revealTargetName = mode.kind === "working_tree" ? mode.revealTargetName : undefined;
  const onDuplicate = mode.kind === "working_tree" ? mode.onDuplicate : undefined;
  const onRevert = mode.kind === "working_tree" ? mode.onRevert : undefined;
  // Keep selection independent from expansion so future keyboard actions (such as R to rename)
  // can target the current VCS file or folder without changing its open state.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const handleSelectPath = useCallback((path: string) => setSelectedPath(path), []);
  const [changesSearch, setChangesSearch] = useState<ChangesSearchState>(CLOSED_CHANGES_SEARCH);
  const [lspHover, setLspHover] = useState<{
    text: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const selectedSearchMatch = changesSearch.matches[changesSearch.selectedIndex];
  const navigationHighlight = useMemo<DiffNavigationHighlight | undefined>(() => {
    if (selectedSearchMatch?.kind === "text") {
      return {
        filePath: selectedSearchMatch.filePath,
        lineStart: selectedSearchMatch.lineNumber,
        lineEnd: selectedSearchMatch.lineNumber,
      };
    }
    if (!focusPath || !focusLineStart) return undefined;
    return {
      filePath: focusPath,
      lineStart: focusLineStart,
      lineEnd: Math.max(focusLineStart, focusLineEnd ?? focusLineStart),
    };
  }, [focusLineEnd, focusLineStart, focusPath, selectedSearchMatch]);
  const expandingFilePaths = useMemo(
    () => new Set(expandingFilePathsArray),
    [expandingFilePathsArray],
  );
  const compressedTree = useMemo(() => compressSingleChildChains(buildDiffTree(files)), [files]);
  const allFolderPaths = useMemo(() => collectDirPaths(compressedTree), [compressedTree]);
  const allFolderPathSet = useMemo(() => new Set(allFolderPaths), [allFolderPaths]);
  useEffect(() => {
    if (
      selectedPath &&
      !allFolderPathSet.has(selectedPath) &&
      !files.some((file) => file.path === selectedPath)
    ) {
      setSelectedPath(null);
    }
  }, [allFolderPathSet, files, selectedPath]);
  const effectiveCollapsedFolders = useMemo(
    () => new Set(Array.from(collapsedFolders).filter((path) => allFolderPathSet.has(path))),
    [allFolderPathSet, collapsedFolders],
  );
  const diffListRef = useRef<FlatList<DiffFlatItem>>(null);
  const diffReviewSurfaceRef = useRef<View>(null);
  const viewportPreservationRef = useRef<{
    scrollTop: number;
    surfaceElement: HTMLElement | null;
    focusedElement: HTMLElement | null;
    focusedTestID: string | null;
    operationId: number;
  } | null>(null);
  const nextViewportOperationIdRef = useRef(1);
  const scrollbar = useOverlayFlatListScrollbar(diffListRef, {
    enabled: !isCompact,
  });
  const { onLayout: updateScrollbarLayout, onScroll: updateScrollbarOffset } = scrollbar;
  const consumedFocusRequestRef = useRef<string | null>(null);
  const pendingFocusRequestRef = useRef<string | null>(null);
  const diffListScrollOffsetRef = useRef(0);
  const diffListViewportHeightRef = useRef(0);
  const headerHeightByPathRef = useRef<Record<string, number>>({});
  const bodyHeightByKeyRef = useRef<Record<string, number>>({});
  const folderRowHeightRef = useRef<number>(0);
  const defaultHeaderHeightRef = useRef<number>(44);
  const [heightVersion, setHeightVersion] = useState(0);
  const [diffListViewportHeight, setDiffListViewportHeight] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const focusChangesHandlerIdRef = useRef(`changes-focus:${Math.random().toString(36).slice(2)}`);
  const [lastAutoApprovedLine, setLastAutoApprovedLine] = useState<ReviewableChangedLine | null>(
    null,
  );

  const restorePreservedViewport = useCallback((operationId?: number) => {
    if (!isWeb) return;
    const snapshot = viewportPreservationRef.current;
    if (!snapshot || (operationId !== undefined && snapshot.operationId !== operationId)) return;
    const scrollElement = diffListRef.current?.getNativeScrollRef();
    if (!(scrollElement instanceof HTMLElement)) return;
    scrollElement.scrollTop = snapshot.scrollTop;
    diffListScrollOffsetRef.current = snapshot.scrollTop;
    let focusedElement = snapshot.focusedElement?.isConnected ? snapshot.focusedElement : null;
    if (!focusedElement && snapshot.focusedTestID) {
      const focusRoot = snapshot.surfaceElement?.isConnected ? snapshot.surfaceElement : document;
      focusedElement = focusRoot.querySelector<HTMLElement>(
        `[data-testid="${
          globalThis.CSS?.escape(snapshot.focusedTestID) ?? snapshot.focusedTestID
        }"]`,
      );
    }
    if (focusedElement?.isConnected) {
      focusedElement.focus({ preventScroll: true });
    } else {
      scrollElement.focus({ preventScroll: true });
    }
  }, []);

  const finishViewportPreservation = useCallback(
    (operationId: number) => {
      requestAnimationFrame(() => {
        restorePreservedViewport(operationId);
        requestAnimationFrame(() => {
          restorePreservedViewport(operationId);
          if (viewportPreservationRef.current?.operationId === operationId) {
            viewportPreservationRef.current = null;
          }
        });
      });
    },
    [restorePreservedViewport],
  );

  const runManualExpansion = useCallback(
    (operation: () => void | Promise<void>) => {
      if (!isWeb) {
        void operation();
        return;
      }
      const scrollElement = diffListRef.current?.getNativeScrollRef();
      if (!(scrollElement instanceof HTMLElement)) {
        void operation();
        return;
      }
      const operationId = nextViewportOperationIdRef.current++;
      const surface = diffReviewSurfaceRef.current;
      const surfaceElement = surface instanceof HTMLElement ? surface : null;
      const activeElement = document.activeElement;
      viewportPreservationRef.current = {
        scrollTop: scrollElement.scrollTop,
        surfaceElement,
        focusedElement:
          activeElement instanceof HTMLElement && surfaceElement?.contains(activeElement)
            ? activeElement
            : null,
        focusedTestID:
          activeElement instanceof HTMLElement && surfaceElement?.contains(activeElement)
            ? (activeElement.dataset.testid ?? null)
            : null,
        operationId,
      };
      try {
        const result = operation();
        if (result instanceof Promise) {
          void result.finally(() => finishViewportPreservation(operationId));
        } else {
          finishViewportPreservation(operationId);
        }
      } catch (error) {
        finishViewportPreservation(operationId);
        throw error;
      }
    },
    [finishViewportPreservation],
  );

  useLayoutEffect(() => {
    restorePreservedViewport();
  }, [collapsedFoldersArray, expandedPathsArray, files, heightVersion, restorePreservedViewport]);

  const handleManualExpandContext = useCallback(
    (filePath: string, region: DiffContextRegion, direction: "up" | "down" | "all") => {
      if (!onExpandContext) return;
      runManualExpansion(() => onExpandContext(filePath, region, direction));
    },
    [onExpandContext, runManualExpansion],
  );

  const handleManualExpandFile = useCallback(
    (filePath: string) => {
      if (!onExpandFile) return;
      runManualExpansion(() => onExpandFile(filePath));
    },
    [onExpandFile, runManualExpansion],
  );
  const orderedReviewLines = useMemo(() => {
    if (!fileReviews) return [];
    const byPath = new Map(fileReviews.files.map((file) => [file.path, file.lines] as const));
    return files.flatMap((file) => byPath.get(file.path) ?? []);
  }, [fileReviews, files]);
  const selectedLine = useMemo(
    () => orderedReviewLines.find((line) => line.id === selectedLineId) ?? null,
    [orderedReviewLines, selectedLineId],
  );
  const handleSelectReviewLine = useCallback((line: ReviewableChangedLine) => {
    setSelectedLineId(line.id);
  }, []);
  const setReviewFileExpanded = useCallback(
    (path: string, expanded: boolean) => {
      if (mode.kind === "commit") return;
      const expansionChanged = expanded !== expandedPaths.has(path);
      if (expansionChanged) {
        const next = expanded
          ? Array.from(new Set([...expandedPaths, path]))
          : Array.from(expandedPaths).filter((candidate) => candidate !== path);
        mode.onExpandedPathsChange(next);
      }
      if (expanded && mode.kind === "working_tree") {
        const directoryParts = path.split("/").slice(0, -1);
        const ancestors = new Set(
          directoryParts.map((_, index) => directoryParts.slice(0, index + 1).join("/")),
        );
        const nextCollapsed = mode.collapsedFolders.filter((folder) => !ancestors.has(folder));
        if (nextCollapsed.length !== mode.collapsedFolders.length) {
          mode.onCollapsedFoldersChange(nextCollapsed);
        }
      }
    },
    [expandedPaths, mode],
  );
  const handleToggleReviewLine = useCallback(
    (line: ReviewableChangedLine) => {
      if (!fileReviews) return;
      const currentlyReviewed = fileReviews.reviewedLineIds.has(line.id);
      fileReviews.toggleLine(line);
      if (!currentlyReviewed) {
        const progress = fileReviews.lineProgressByPath.get(line.target.filePath);
        if (progress && progress.total > 0 && progress.reviewed + 1 === progress.total) {
          setReviewFileExpanded(line.target.filePath, false);
          setSelectedLineId(null);
        }
      }
    },
    [fileReviews, setReviewFileExpanded],
  );
  const lineReviewPresentation = useMemo<LineReviewPresentation | undefined>(
    () =>
      fileReviews
        ? {
            fileReviews,
            selectedLineId,
            onSelectLine: handleSelectReviewLine,
            onToggleLine: handleToggleReviewLine,
          }
        : undefined,
    [fileReviews, handleSelectReviewLine, handleToggleReviewLine, selectedLineId],
  );
  const heightVersionFrameRef = useRef<number | null>(null);
  const scheduleHeightVersionUpdate = useCallback(() => {
    if (heightVersionFrameRef.current !== null) {
      return;
    }
    heightVersionFrameRef.current = requestAnimationFrame(() => {
      heightVersionFrameRef.current = null;
      setHeightVersion((version) => version + 1);
    });
  }, []);
  useEffect(
    () => () => {
      if (heightVersionFrameRef.current !== null) {
        cancelAnimationFrame(heightVersionFrameRef.current);
      }
    },
    [],
  );
  const diffBodyChromeHeight = BORDER_WIDTH[1] * 2;
  const statusBodyHeightEstimate = diffBodyChromeHeight + SPACING[4] * 2 + diffBodyLineHeight;

  const { flatItems, stickyHeaderIndices } = useMemo(() => {
    const { items, stickyHeaderIndices: stickyIndices } = buildDiffFlatItems({
      files,
      viewMode,
      tree: compressedTree,
      collapsedFolders: effectiveCollapsedFolders,
      expandedPaths,
    });
    return {
      flatItems: items,
      stickyHeaderIndices: stickyHeaders ? stickyIndices : [],
    };
  }, [compressedTree, effectiveCollapsedFolders, expandedPaths, files, stickyHeaders, viewMode]);

  const getBodyHeightKey = useCallback(
    (file: ParsedDiffFile): string => {
      if (file.status === "too_large" || file.status === "binary") {
        return `${layout}:${wrapLines ? "wrap" : "scroll"}:${typographyKey}:${
          file.path
        }:${file.status}`;
      }

      const metrics = getDiffFileMetrics(file);
      return [
        layout,
        wrapLines ? "wrap" : "scroll",
        typographyKey,
        file.path,
        file.status ?? "ok",
        file.additions,
        file.deletions,
        file.hunks.length,
        metrics.unifiedLineCount,
        metrics.contentLength,
      ].join(":");
    },
    [layout, typographyKey, wrapLines],
  );

  const estimateBodyHeight = useCallback(
    (file: ParsedDiffFile): number => {
      if (file.status === "too_large" || file.status === "binary") {
        return statusBodyHeightEstimate;
      }

      const lineCount =
        layout === "split"
          ? getSplitDiffLineCount(file)
          : getDiffFileMetrics(file).unifiedLineCount;
      return diffBodyChromeHeight + lineCount * diffBodyLineHeight;
    },
    [diffBodyChromeHeight, diffBodyLineHeight, layout, statusBodyHeightEstimate],
  );

  const getFlatItemHeight = useCallback(
    (item: DiffFlatItem): number => {
      if (item.type === "folder") {
        return folderRowHeightRef.current || defaultHeaderHeightRef.current;
      }
      if (item.type === "header") {
        return headerHeightByPathRef.current[item.file.path] ?? defaultHeaderHeightRef.current;
      }
      const bodyHeightKey = getBodyHeightKey(item.file);
      return bodyHeightByKeyRef.current[bodyHeightKey] ?? estimateBodyHeight(item.file);
    },
    [estimateBodyHeight, getBodyHeightKey],
  );

  const handleFolderRowHeightChange = useCallback(
    (height: number) => {
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      const previousHeight = folderRowHeightRef.current;
      if (previousHeight > 0 && Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON) {
        return;
      }
      folderRowHeightRef.current = height;
      scheduleHeightVersionUpdate();
    },
    [scheduleHeightVersionUpdate],
  );

  const handleHeaderHeightChange = useCallback(
    (path: string, height: number) => {
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      const previousHeight = headerHeightByPathRef.current[path];
      if (
        previousHeight !== undefined &&
        Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON
      ) {
        return;
      }
      headerHeightByPathRef.current[path] = height;
      defaultHeaderHeightRef.current = height;
      scheduleHeightVersionUpdate();
    },
    [scheduleHeightVersionUpdate],
  );

  const handleBodyHeightChange = useCallback(
    (file: ParsedDiffFile, height: number) => {
      if (!Number.isFinite(height) || height < 0) {
        return;
      }
      const heightKey = getBodyHeightKey(file);
      const previousHeight = bodyHeightByKeyRef.current[heightKey];
      if (
        previousHeight !== undefined &&
        Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON
      ) {
        return;
      }
      bodyHeightByKeyRef.current[heightKey] = height;
      scheduleHeightVersionUpdate();
    },
    [getBodyHeightKey, scheduleHeightVersionUpdate],
  );

  const handleDiffListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      diffListScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      updateScrollbarOffset(event);
    },
    [updateScrollbarOffset],
  );

  const handleDiffListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      updateScrollbarLayout(event);
      const height = event.nativeEvent.layout.height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      diffListViewportHeightRef.current = height;
      setDiffListViewportHeight(height);
    },
    [updateScrollbarLayout],
  );

  const diffListContentStyle = useMemo(
    () => [
      styles.contentContainer,
      focusPath &&
        diffListViewportHeight > 0 &&
        inlineUnistylesStyle({ paddingBottom: diffListViewportHeight }),
    ],
    [diffListViewportHeight, focusPath],
  );

  const computeItemOffset = useCallback(
    (predicate: (item: DiffFlatItem) => boolean): number | null => {
      const index = flatItems.findIndex(predicate);
      if (index < 0) {
        return null;
      }
      return sumHeightsBefore(flatItems, index, getFlatItemHeight);
    },
    [flatItems, getFlatItemHeight],
  );

  const computeHeaderOffset = useCallback(
    (path: string): number =>
      computeItemOffset((item) => item.type === "header" && item.file.path === path) ?? 0,
    [computeItemOffset],
  );

  const focusDiffScrollSurface = useCallback(() => {
    if (!isWeb) {
      return;
    }
    const scrollElement = diffListRef.current?.getNativeScrollRef();
    if (scrollElement instanceof HTMLElement) {
      // File navigation is a focus handoff: keyboard scrolling must continue in
      // the diff rather than remaining on the file-tree activation control.
      scrollElement.focus({ preventScroll: true });
    }
  }, []);

  const revealSearchMatch = useCallback(
    async (match: ChangesSearchMatch) => {
      setReviewFileExpanded(match.filePath, true);
      if (match.kind === "file") {
        diffListRef.current?.scrollToOffset({
          offset: computeHeaderOffset(match.filePath),
          animated: false,
        });
        requestAnimationFrame(focusDiffScrollSurface);
        return;
      }
      await onExpandFile?.(match.filePath);
      let attempts = 30;
      const reveal = () => {
        const escape =
          globalThis.CSS?.escape ?? ((value: string) => value.replace(/["\\]/g, "\\$&"));
        const element = document.querySelector<HTMLElement>(
          `[data-paseito-diff-file="${escape(
            match.filePath,
          )}"][data-paseito-diff-current-line="${match.lineNumber}"]`,
        );
        if (element) {
          element.scrollIntoView({ block: "center", inline: "nearest" });
          focusDiffScrollSurface();
          return;
        }
        if (attempts > 0) {
          attempts -= 1;
          requestAnimationFrame(reveal);
        }
      };
      requestAnimationFrame(reveal);
    },
    [computeHeaderOffset, focusDiffScrollSurface, onExpandFile, setReviewFileExpanded],
  );

  const selectSearchMatch = useCallback(
    (index: number) => {
      if (changesSearch.matches.length === 0) return;
      const selectedIndex = (index + changesSearch.matches.length) % changesSearch.matches.length;
      setChangesSearch((current) => ({ ...current, selectedIndex }));
      void revealSearchMatch(changesSearch.matches[selectedIndex]);
    },
    [changesSearch.matches, revealSearchMatch],
  );

  const submitChangesSearch = useCallback(async () => {
    const query = changesSearch.query.trim();
    if (!query || !onSearch) return;
    setChangesSearch((current) => ({
      ...current,
      status: "loading",
      error: null,
    }));
    searchInputRef.current?.blur();
    try {
      const result = await onSearch(query);
      setChangesSearch((current) => ({
        ...current,
        status: "ready",
        matches: result.matches,
        selectedIndex: result.matches.length > 0 ? 0 : -1,
        truncated: result.truncated,
      }));
      if (result.matches[0]) void revealSearchMatch(result.matches[0]);
    } catch (error) {
      setChangesSearch((current) => ({
        ...current,
        status: "error",
        matches: [],
        selectedIndex: -1,
        error: error instanceof Error ? error.message : t("workspace.git.diff.search.failed"),
      }));
    }
  }, [changesSearch.query, onSearch, revealSearchMatch, t]);
  const handleSearchQueryChange = useCallback((query: string) => {
    setChangesSearch((current) => ({ ...current, query, status: "idle" }));
  }, []);
  const handleSearchSubmit = useCallback(() => {
    void submitChangesSearch();
  }, [submitChangesSearch]);

  useEffect(() => {
    if (!isWeb || !keyboardEnabled || !onSearch) return;
    const handleSearchKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const editing = Boolean(
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [data-testid='file-source-editor']",
        ),
      );
      if (!changesSearch.open) {
        if (event.key !== "/" || editing) return;
        event.preventDefault();
        setChangesSearch({ ...CLOSED_CHANGES_SEARCH, open: true });
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setChangesSearch(CLOSED_CHANGES_SEARCH);
        focusDiffScrollSurface();
        return;
      }
      if (editing) return;
      if (event.key === "n") {
        event.preventDefault();
        selectSearchMatch(changesSearch.selectedIndex + 1);
      } else if (event.key === "N") {
        event.preventDefault();
        selectSearchMatch(changesSearch.selectedIndex - 1);
      }
    };
    window.addEventListener("keydown", handleSearchKeyDown);
    return () => window.removeEventListener("keydown", handleSearchKeyDown);
  }, [
    changesSearch.open,
    changesSearch.selectedIndex,
    focusDiffScrollSurface,
    keyboardEnabled,
    onSearch,
    selectSearchMatch,
  ]);

  useEffect(() => {
    if (!isWeb || !keyboardEnabled || !changesLsp?.enabled) return;
    const surface = diffReviewSurfaceRef.current;
    if (!(surface instanceof HTMLElement)) return;
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let hoverSequence = 0;
    let lastTarget: ChangesLspTarget | null = null;
    const clearHoverTimer = () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = null;
    };
    const requestHover = (target: ChangesLspTarget) => {
      clearHoverTimer();
      lastTarget = target;
      const sequence = ++hoverSequence;
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        void (async () => {
          const value = await changesLsp.hover(target.filePath, target.lineNumber, target.column);
          if (sequence !== hoverSequence) return;
          const surfaceBounds = surface.getBoundingClientRect();
          setLspHover(
            value
              ? {
                  text: value,
                  clientX: target.clientX - surfaceBounds.left,
                  clientY: target.clientY - surfaceBounds.top,
                }
              : null,
          );
        })();
      }, 350);
    };
    const handleMouseMove = (event: MouseEvent) => {
      const target = resolveChangesLspTarget(event);
      if (!target) {
        clearHoverTimer();
        lastTarget = null;
        setLspHover(null);
        return;
      }
      const unchanged =
        lastTarget?.filePath === target.filePath &&
        lastTarget.lineNumber === target.lineNumber &&
        lastTarget.column === target.column;
      if (!unchanged) requestHover(target);
    };
    const handleClick = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return;
      const target = resolveChangesLspTarget(event);
      if (!target) return;
      event.preventDefault();
      void changesLsp.definition(target.filePath, target.lineNumber, target.column);
    };
    const handleContextMenu = (event: MouseEvent) => {
      const showContextMenu = window.paseoDesktop?.menu?.showContextMenu;
      const target = resolveChangesLspTarget(event);
      if (!target || typeof showContextMenu !== "function") return;
      event.preventDefault();
      void showContextMenu({ kind: "editor-lsp" }).then((action) => {
        if (action === "go-to-definition") {
          return changesLsp.definition(target.filePath, target.lineNumber, target.column);
        }
        return undefined;
      });
    };
    const handleMouseLeave = () => setLspHover(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F12" || !lastTarget || !surface.contains(document.activeElement)) return;
      event.preventDefault();
      void changesLsp.definition(lastTarget.filePath, lastTarget.lineNumber, lastTarget.column);
    };
    surface.addEventListener("mousemove", handleMouseMove);
    surface.addEventListener("click", handleClick);
    surface.addEventListener("contextmenu", handleContextMenu);
    surface.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      hoverSequence += 1;
      clearHoverTimer();
      setLspHover(null);
      surface.removeEventListener("mousemove", handleMouseMove);
      surface.removeEventListener("click", handleClick);
      surface.removeEventListener("contextmenu", handleContextMenu);
      surface.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [changesLsp, keyboardEnabled]);

  const handleFocusChanges = useCallback((): boolean => {
    onActivate?.();
    const target =
      selectedLine ??
      orderedReviewLines.find((line) => !fileReviews?.reviewedLineIds.has(line.id)) ??
      orderedReviewLines[0] ??
      null;
    if (target) {
      setReviewFileExpanded(target.target.filePath, true);
      setSelectedLineId(target.id);
      requestAnimationFrame(focusDiffScrollSurface);
      return true;
    }
    const firstFile = files[0];
    if (!firstFile) return false;
    setReviewFileExpanded(firstFile.path, true);
    diffListRef.current?.scrollToOffset({
      offset: computeHeaderOffset(firstFile.path),
      animated: false,
    });
    requestAnimationFrame(focusDiffScrollSurface);
    return true;
  }, [
    computeHeaderOffset,
    fileReviews,
    files,
    focusDiffScrollSurface,
    orderedReviewLines,
    selectedLine,
    setReviewFileExpanded,
    onActivate,
  ]);

  useKeyboardActionHandler({
    handlerId: focusChangesHandlerIdRef.current,
    actions: ["changes.focus"],
    enabled: focusShortcutEnabled,
    priority: 250,
    handle: handleFocusChanges,
  });

  useEffect(() => {
    if (!selectedLineId) return;
    if (!orderedReviewLines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(null);
      setLastAutoApprovedLine(null);
    }
  }, [orderedReviewLines, selectedLineId]);

  useEffect(() => {
    if (!isWeb || !keyboardEnabled || !selectedLine) return;
    setReviewFileExpanded(selectedLine.target.filePath, true);
    let frame: number | null = null;
    let remainingAttempts = 12;
    let revealedFileHeader = false;
    const revealSelectedLine = () => {
      const escape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/["\\]/g, "\\$&"));
      const element = document.querySelector<HTMLElement>(
        `[data-paseito-review-target-key="${escape(
          selectedLine.target.key,
        )}"][data-paseito-review-selected="true"]`,
      );
      if (element) {
        revealReviewElement({
          element,
          file: files.find((file) => file.path === selectedLine.target.filePath),
          line: selectedLine,
          escapeSelector: escape,
          focus: focusDiffScrollSurface,
        });
        return;
      }
      if (!revealedFileHeader) {
        revealedFileHeader = true;
        diffListRef.current?.scrollToOffset({
          offset: computeHeaderOffset(selectedLine.target.filePath),
          animated: false,
        });
      }
      if (remainingAttempts > 0) {
        remainingAttempts -= 1;
        frame = requestAnimationFrame(revealSelectedLine);
      }
    };
    frame = requestAnimationFrame(revealSelectedLine);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
    // Revealing belongs to a new selection, not to every render that recreates
    // the selected line or its surrounding review state. Inline editors change
    // row height and review state; rerunning here would recenter the old
    // checkbox selection and steal focus from the new editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardEnabled, selectedLineId]);

  const handleEditSelectedLine = useCallback(() => {
    if (!selectedLine) return;
    if (onEditLine && selectedLine.target.editLineNumber) onEditLine(selectedLine);
    else toast.show(t("workspace.git.diff.editLineUnavailable"));
  }, [onEditLine, selectedLine, t, toast]);

  const handleUndoAutoApproval = useCallback(() => {
    if (!fileReviews || !lastAutoApprovedLine) return;
    if (fileReviews.reviewedLineIds.has(lastAutoApprovedLine.id)) {
      fileReviews.toggleLine(lastAutoApprovedLine);
    }
    setReviewFileExpanded(lastAutoApprovedLine.target.filePath, true);
    setSelectedLineId(lastAutoApprovedLine.id);
    setLastAutoApprovedLine(null);
  }, [fileReviews, lastAutoApprovedLine, setReviewFileExpanded]);

  const handleMoveReviewSelection = useCallback(
    (direction: "up" | "down") => {
      if (!selectedLine || !fileReviews) return;
      const wasReviewed = fileReviews.reviewedLineIds.has(selectedLine.id);
      if (!wasReviewed) {
        fileReviews.markLine(selectedLine);
        setLastAutoApprovedLine(selectedLine);
      }
      const projectedReviewed = new Set(fileReviews.reviewedLineIds);
      projectedReviewed.add(selectedLine.id);
      const next = findNextUncheckedLine({
        lines: orderedReviewLines,
        selectedLineId: selectedLine.id,
        reviewedLineIds: projectedReviewed,
        direction,
      });
      const progress = fileReviews.lineProgressByPath.get(selectedLine.target.filePath);
      if (!wasReviewed && progress && progress.reviewed + 1 === progress.total) {
        setReviewFileExpanded(selectedLine.target.filePath, false);
      }
      if (next) {
        setReviewFileExpanded(next.target.filePath, true);
        setSelectedLineId(next.id);
        return;
      }
      setSelectedLineId(null);
      toast.show(t("workspace.git.diff.noUncheckedLines"));
    },
    [fileReviews, orderedReviewLines, selectedLine, setReviewFileExpanded, t, toast],
  );

  const handleExpandAdjacentContext = useCallback(
    (direction: "above" | "below") => {
      if (!selectedLine || !onExpandContext) return;
      const file = files.find((candidate) => candidate.path === selectedLine.target.filePath);
      const lineNumber = selectedLine.target.newLineNumber ?? selectedLine.target.editLineNumber;
      if (!file || !lineNumber) return;
      const regions = file.hunks.flatMap((hunk) =>
        hunk.lines.flatMap((line) => {
          const region = parseDiffContextMarker(line.content);
          return region ? [region] : [];
        }),
      );
      const region = findAdjacentHiddenContext({
        regions,
        lineNumber,
        direction,
      });
      if (region) handleManualExpandContext(file.path, region, "all");
    },
    [files, handleManualExpandContext, onExpandContext, selectedLine],
  );

  useEffect(() => {
    if (!isWeb || !keyboardEnabled || !selectedLine || !fileReviews) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [data-testid='file-source-editor']",
        )
      ) {
        return;
      }
      const action = getLineReviewKeyboardAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action === "clear") {
        setSelectedLineId(null);
        setLastAutoApprovedLine(null);
      } else if (action === "toggle") handleToggleReviewLine(selectedLine);
      else if (action === "edit") handleEditSelectedLine();
      else if (action === "undo") handleUndoAutoApproval();
      else if (action === "expand-below") handleExpandAdjacentContext("below");
      else if (action === "expand-above") handleExpandAdjacentContext("above");
      else handleMoveReviewSelection(action === "move-down" ? "down" : "up");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    fileReviews,
    handleEditSelectedLine,
    handleExpandAdjacentContext,
    handleMoveReviewSelection,
    handleToggleReviewLine,
    handleUndoAutoApproval,
    keyboardEnabled,
    selectedLine,
  ]);

  useEffect(() => {
    if (!focusPath || focusLineStart) {
      return;
    }
    const focusRequestKey = `${focusRequestId ?? "initial"}:${focusPath}`;
    if (
      consumedFocusRequestRef.current === focusRequestKey ||
      pendingFocusRequestRef.current === focusRequestKey
    ) {
      return;
    }
    const hasTarget = flatItems.some(
      (item) => item.type === "header" && item.file.path === focusPath,
    );
    if (!hasTarget) {
      return;
    }
    pendingFocusRequestRef.current = focusRequestKey;
    const frame = requestAnimationFrame(() => {
      diffListRef.current?.scrollToOffset({
        offset: computeHeaderOffset(focusPath),
        animated: false,
      });
      focusDiffScrollSurface();
      consumedFocusRequestRef.current = focusRequestKey;
      pendingFocusRequestRef.current = null;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (pendingFocusRequestRef.current === focusRequestKey) {
        pendingFocusRequestRef.current = null;
      }
    };
  }, [
    computeHeaderOffset,
    flatItems,
    focusDiffScrollSurface,
    focusLineStart,
    focusPath,
    focusRequestId,
  ]);

  useEffect(() => {
    if (!isWeb || !focusPath || !focusLineStart) {
      return;
    }
    const focusRequestKey = `${focusRequestId ?? "initial"}:${focusPath}:${focusLineStart}`;
    if (
      consumedFocusRequestRef.current === focusRequestKey ||
      pendingFocusRequestRef.current === focusRequestKey
    ) {
      return;
    }
    const hasTargetFile = flatItems.some(
      (item) => item.type === "header" && item.file.path === focusPath,
    );
    if (!hasTargetFile) {
      return;
    }

    setReviewFileExpanded(focusPath, true);
    pendingFocusRequestRef.current = focusRequestKey;
    diffListRef.current?.scrollToOffset({
      offset: computeHeaderOffset(focusPath),
      animated: false,
    });

    let frame: number | null = null;
    let remainingAttempts = 20;
    const revealLine = () => {
      const escape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/["\\]/g, "\\$&"));
      const element = document.querySelector<HTMLElement>(
        `[data-paseito-diff-file="${escape(
          focusPath,
        )}"][data-paseito-diff-current-line="${focusLineStart}"]`,
      );
      const scrollElement = element?.closest<HTMLElement>('[data-testid="git-diff-scroll"]');
      if (element && scrollElement instanceof HTMLElement) {
        const viewportBounds = scrollElement.getBoundingClientRect();
        const lineBounds = element.getBoundingClientRect();
        const headerHeight =
          headerHeightByPathRef.current[focusPath] ?? defaultHeaderHeightRef.current;
        const targetOffset = scrollElement.scrollTop + lineBounds.top - viewportBounds.top;
        scrollElement.scrollTop = Math.max(0, targetOffset - headerHeight - 12);
        if (
          !wrapLines &&
          focusColumn &&
          !revealDiffNavigationColumn(element, focusColumn, codeFontSize, scrollElement) &&
          remainingAttempts > 0
        ) {
          remainingAttempts -= 1;
          frame = requestAnimationFrame(revealLine);
          return;
        }
        focusDiffScrollSurface();
        consumedFocusRequestRef.current = focusRequestKey;
        pendingFocusRequestRef.current = null;
        return;
      }
      if (remainingAttempts > 0) {
        remainingAttempts -= 1;
        frame = requestAnimationFrame(revealLine);
      } else if (pendingFocusRequestRef.current === focusRequestKey) {
        pendingFocusRequestRef.current = null;
      }
    };
    frame = requestAnimationFrame(revealLine);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (pendingFocusRequestRef.current === focusRequestKey) {
        pendingFocusRequestRef.current = null;
      }
    };
  }, [
    codeFontSize,
    computeHeaderOffset,
    flatItems,
    focusColumn,
    focusDiffScrollSurface,
    focusLineStart,
    focusPath,
    focusRequestId,
    setReviewFileExpanded,
    wrapLines,
  ]);

  const handleToggleExpanded = useCallback(
    (path: string) => {
      if (mode.kind === "commit") {
        return;
      }
      const isCurrentlyExpanded = expandedPaths.has(path);
      const nextExpanded = !isCurrentlyExpanded;
      const targetOffset = isCurrentlyExpanded ? computeHeaderOffset(path) : null;
      const headerHeight = headerHeightByPathRef.current[path] ?? defaultHeaderHeightRef.current;
      const shouldAnchor =
        isCurrentlyExpanded &&
        targetOffset !== null &&
        shouldAnchorHeaderBeforeCollapse({
          headerOffset: targetOffset,
          headerHeight,
          viewportOffset: diffListScrollOffsetRef.current,
          viewportHeight: diffListViewportHeightRef.current,
        });

      if (shouldAnchor && targetOffset !== null) {
        diffListRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
      }

      const updateExpandedPaths = () =>
        mode.onExpandedPathsChange(
          nextExpanded
            ? [...expandedPaths, path]
            : Array.from(expandedPaths).filter((expandedPath) => expandedPath !== path),
        );
      if (nextExpanded) runManualExpansion(updateExpandedPaths);
      else updateExpandedPaths();
    },
    [computeHeaderOffset, expandedPaths, mode, runManualExpansion],
  );

  const handleToggleReviewed = useCallback(
    (path: string) => {
      if (mode.kind === "commit" || !fileReviews) return;
      const isNowReviewed = fileReviews.toggle(path);
      const updateExpandedPaths = () =>
        mode.onExpandedPathsChange(
          isNowReviewed
            ? collapseReviewedFile(expandedPaths, path)
            : expandUnreviewedFile(expandedPaths, path),
        );
      if (isNowReviewed) updateExpandedPaths();
      else runManualExpansion(updateExpandedPaths);
    },
    [expandedPaths, fileReviews, mode, runManualExpansion],
  );

  useEffect(() => {
    if (mode.kind === "commit" || !fileReviews || fileReviews.invalidatedPaths.length === 0) return;
    mode.onExpandedPathsChange(expandInvalidatedFiles(expandedPaths, fileReviews.invalidatedPaths));
  }, [expandedPaths, fileReviews, mode]);

  const handleToggleFolder = useCallback(
    (dirPath: string) => {
      if (mode.kind !== "working_tree") {
        return;
      }
      const isCurrentlyCollapsed = effectiveCollapsedFolders.has(dirPath);
      if (!isCurrentlyCollapsed) {
        const targetOffset = computeItemOffset(
          (item) => item.type === "folder" && item.dirPath === dirPath,
        );
        const folderHeight = folderRowHeightRef.current || defaultHeaderHeightRef.current;
        if (
          targetOffset !== null &&
          shouldAnchorHeaderBeforeCollapse({
            headerOffset: targetOffset,
            headerHeight: folderHeight,
            viewportOffset: diffListScrollOffsetRef.current,
            viewportHeight: diffListViewportHeightRef.current,
          })
        ) {
          diffListRef.current?.scrollToOffset({
            offset: targetOffset,
            animated: false,
          });
        }
      }

      const updateCollapsedFolders = () =>
        mode.onCollapsedFoldersChange(
          isCurrentlyCollapsed
            ? Array.from(effectiveCollapsedFolders).filter((path) => path !== dirPath)
            : [...effectiveCollapsedFolders, dirPath],
        );
      if (isCurrentlyCollapsed) runManualExpansion(updateCollapsedFolders);
      else updateCollapsedFolders();
    },
    [computeItemOffset, effectiveCollapsedFolders, mode, runManualExpansion],
  );

  const handleCollapseFolder = useCallback(
    (dirPath: string) => {
      if (mode.kind !== "working_tree") {
        return;
      }
      const targetOffset = computeItemOffset(
        (item) => item.type === "folder" && item.dirPath === dirPath,
      );
      const folderHeight = folderRowHeightRef.current || defaultHeaderHeightRef.current;
      if (
        targetOffset !== null &&
        shouldAnchorHeaderBeforeCollapse({
          headerOffset: targetOffset,
          headerHeight: folderHeight,
          viewportOffset: diffListScrollOffsetRef.current,
          viewportHeight: diffListViewportHeightRef.current,
        })
      ) {
        diffListRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
      }

      const pathPrefix = `${dirPath}/`;
      mode.onCollapsedFoldersChange([
        ...new Set([
          ...effectiveCollapsedFolders,
          ...allFolderPaths.filter(
            (folderPath) => folderPath === dirPath || folderPath.startsWith(pathPrefix),
          ),
        ]),
      ]);
    },
    [allFolderPaths, computeItemOffset, effectiveCollapsedFolders, mode],
  );

  const renderFlatItem = useCallback(
    ({ item }: { item: DiffFlatItem }) => {
      if (item.type === "folder") {
        return (
          <DiffFolderRow
            dirPath={item.dirPath}
            displayName={item.displayName}
            depth={item.depth}
            collapsed={item.collapsed}
            isSelected={selectedPath === item.dirPath}
            additions={item.additions}
            deletions={item.deletions}
            onToggle={handleToggleFolder}
            onCollapse={handleCollapseFolder}
            onSelect={handleSelectPath}
            onHeightChange={handleFolderRowHeightChange}
            onCopyPath={onCopyPath}
            onCopyRelativePath={onCopyRelativePath}
            onReveal={onReveal}
            revealTargetName={revealTargetName}
            onDuplicate={onDuplicate}
            onRevert={onRevert}
            testID={`diff-folder-${item.dirPath}`}
          />
        );
      }
      if (item.type === "header") {
        return (
          <DiffFileHeader
            file={item.file}
            workspaceFileDragScope={workspaceFileDragScope}
            isExpanded={item.isExpanded}
            isSelected={selectedPath === item.file.path}
            depth={item.depth}
            showDir={viewMode === "flat"}
            interactive={interactive}
            onToggle={interactive ? (onFilePress ?? handleToggleExpanded) : undefined}
            onSelect={handleSelectPath}
            onOpenFile={onOpenFile}
            onAddToChat={onAddToChat}
            onCopyPath={onCopyPath}
            onCopyRelativePath={onCopyRelativePath}
            onReveal={onReveal}
            revealTargetName={revealTargetName}
            onDownload={onDownload}
            onDuplicate={onDuplicate}
            onRevert={onRevert}
            onHeaderHeightChange={handleHeaderHeightChange}
            fileReviews={fileReviews}
            onToggleReviewed={fileReviews ? handleToggleReviewed : undefined}
            onExpandFile={onExpandFile ? handleManualExpandFile : undefined}
            isExpandingFile={expandingFilePaths.has(item.file.path)}
            lsp={changesLsp}
            testID={`diff-file-${item.fileIndex}`}
          />
        );
      }
      return (
        <DiffFileBody
          file={item.file}
          layout={layout}
          wrapLines={wrapLines}
          codeFontSize={codeFontSize}
          textMetricsStyle={textMetricsStyle}
          reviewActions={reviewActions}
          lineReview={lineReviewPresentation}
          navigation={
            navigationHighlight?.filePath === item.file.path ? navigationHighlight : undefined
          }
          onExpandContext={onExpandContext ? handleManualExpandContext : undefined}
          onBodyHeightChange={handleBodyHeightChange}
          testID={`diff-file-${item.fileIndex}-body`}
        />
      );
    },
    [
      codeFontSize,
      handleBodyHeightChange,
      handleFolderRowHeightChange,
      handleHeaderHeightChange,
      handleCollapseFolder,
      handleSelectPath,
      handleToggleExpanded,
      handleToggleFolder,
      handleToggleReviewed,
      handleManualExpandContext,
      handleManualExpandFile,
      layout,
      reviewActions,
      lineReviewPresentation,
      navigationHighlight,
      fileReviews,
      workspaceFileDragScope,
      changesLsp,
      textMetricsStyle,
      viewMode,
      wrapLines,
      interactive,
      onFilePress,
      onOpenFile,
      onAddToChat,
      onCopyPath,
      onCopyRelativePath,
      onReveal,
      revealTargetName,
      onDownload,
      onDuplicate,
      onRevert,
      selectedPath,
      onExpandContext,
      onExpandFile,
      expandingFilePaths,
    ],
  );

  const flatKeyExtractor = useCallback(
    (item: DiffFlatItem) =>
      item.type === "folder" ? `folder-${item.dirPath}` : `${item.type}-${item.file.path}`,
    [],
  );

  const getFlatItemLayout = useCallback<DiffFlatItemLayoutGetter>(
    (_data, index) => {
      const offset = sumHeightsBefore(flatItems, index, getFlatItemHeight);
      const item = flatItems[index];
      const length = item ? getFlatItemHeight(item) : 0;
      return { length, offset, index };
    },
    [flatItems, getFlatItemHeight],
  );

  const flatExtraData = useMemo(
    () => ({
      expandedPathsArray,
      collapsedFoldersArray,
      layout,
      typographyKey,
      heightVersion,
      viewMode,
      wrapLines,
      reviewActions,
      lineReviewPresentation,
      navigationHighlight,
      fileReviews,
      changesLsp,
      workspaceFileDragScope,
    }),
    [
      expandedPathsArray,
      collapsedFoldersArray,
      heightVersion,
      layout,
      reviewActions,
      lineReviewPresentation,
      navigationHighlight,
      fileReviews,
      changesLsp,
      typographyKey,
      viewMode,
      workspaceFileDragScope,
      wrapLines,
    ],
  );

  return (
    <View
      ref={diffReviewSurfaceRef}
      style={styles.diffReviewSurface}
      dataSet={DIFF_REVIEW_SURFACE_DATASET}
    >
      <FlatList
        ref={diffListRef}
        data={flatItems}
        renderItem={renderFlatItem}
        keyExtractor={flatKeyExtractor}
        getItemLayout={getFlatItemLayout}
        stickyHeaderIndices={stickyHeaderIndices}
        extraData={flatExtraData}
        style={styles.scrollView}
        contentContainerStyle={diffListContentStyle}
        testID="git-diff-scroll"
        tabIndex={-1}
        onLayout={handleDiffListLayout}
        onScroll={handleDiffListScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator
        removeClippedSubviews={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={10}
      />
      {scrollbar.overlay}
      {changesSearch.open ? (
        <View style={styles.changesSearchBar} testID="changes-search-bar">
          <Text style={styles.changesSearchPrompt}>/</Text>
          <TextInput
            ref={searchInputRef}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={handleSearchQueryChange}
            onSubmitEditing={handleSearchSubmit}
            placeholder={t("workspace.git.diff.search.placeholder")}
            placeholderTextColor={styles.changesSearchPlaceholder.color}
            style={styles.changesSearchInput}
            testID="changes-search-input"
            value={changesSearch.query}
          />
          <Text style={styles.changesSearchStatus} testID="changes-search-status">
            {getChangesSearchStatusLabel(changesSearch, t)}
          </Text>
        </View>
      ) : null}
      {lspHover ? (
        <View
          pointerEvents="none"
          style={[
            styles.changesLspHover,
            inlineUnistylesStyle({
              left: lspHover.clientX + 12,
              top: lspHover.clientY + 16,
            }),
          ]}
          testID="changes-lsp-hover"
        >
          <Text style={styles.changesLspHoverText}>{lspHover.text}</Text>
        </View>
      ) : null}
      {selectedLine && !reviewActions?.editor && !reviewActions?.suggestionEditor ? (
        <View
          style={styles.lineReviewShortcutHint}
          accessibilityLiveRegion="polite"
          pointerEvents="none"
        >
          <Text style={styles.lineReviewShortcutHintText}>
            {t("workspace.git.diff.lineReviewShortcuts")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function computeBaseRefLabel(baseRef: string | undefined, fallbackLabel: string): string {
  if (!baseRef) return fallbackLabel;
  const trimmed = baseRef.replace(/^refs\/(heads|remotes)\//, "").trim();
  return trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
}

function computeCommittedDiffDescription(
  branchLabel: string,
  baseRefLabel: string,
): string | undefined {
  if (!branchLabel || !baseRefLabel) {
    return undefined;
  }
  return branchLabel === baseRefLabel ? undefined : `${branchLabel} -> ${baseRefLabel}`;
}

function computePrErrorMessage(
  githubFeaturesEnabled: boolean,
  prPayloadError: { message?: string } | null | undefined,
): string | null {
  if (!githubFeaturesEnabled) return null;
  return prPayloadError?.message ?? null;
}

// The precise setup step a workspace needs before its forge features work, or
// null when nothing is actionable (authenticated, or no forge remote at all).
type ForgeSetupAction = "install_cli" | "sign_in" | null;

// Drive the onboarding callout from the forge's auth state so the message names
// the exact next step (install the CLI vs sign in) for whichever forge backs the
// workspace — GitHub included. GitLab additionally requires the host to advertise
// GitLab support, matching the rest of the GitLab UI.
function computeForgeSetupAction(input: {
  forge: Forge;
  forgeProvidersSupported: boolean;
  authState: ForgeAuthState | undefined;
}): ForgeSetupAction {
  // A daemon without pluggable forge support can't operate any non-GitHub forge,
  // so don't offer a setup action for one it can't drive.
  if (input.forge !== "github" && !input.forgeProvidersSupported) {
    return null;
  }
  switch (input.authState) {
    case "cli_missing":
      return "install_cli";
    case "unauthenticated":
      return "sign_in";
    case "authenticated":
    case "no_remote":
    case "error":
      return null;
    default:
      return null;
  }
}

function parseForgeHost(url: string | null | undefined): string | null {
  return url ? (parseGitRemoteLocation(url)?.host ?? null) : null;
}

function buildForgeSetupMessage(input: {
  action: ForgeSetupAction;
  forge: Forge;
  host: string | null;
  t: TFunction;
}): string | null {
  if (!input.action) {
    return null;
  }
  const { brandLabel, signInCli } = getForgePresentation(input.forge);
  // A forge with no known CLI (an unknown/third-party forge rendered neutrally)
  // has no install/sign-in command to interpolate — show neutral guidance
  // rather than the GitLab-specific callout or a null command.
  if (signInCli === null) {
    return input.t("workspace.git.forgeSetup.generic", { brand: brandLabel });
  }
  if (input.action === "install_cli") {
    return input.t("workspace.git.forgeSetup.installCli", {
      cli: signInCli,
      brand: brandLabel,
    });
  }
  const command = buildForgeSignInCommand(input.forge, input.host);
  return input.t("workspace.git.forgeSetup.signIn", {
    command,
    brand: brandLabel,
  });
}

function buildDiffModeTriggerStyle(): PressableStyleFn {
  return ({ hovered, pressed, open }) => [
    styles.diffModeTrigger,
    (Boolean(hovered) || pressed || Boolean(open)) && styles.diffModeTriggerHovered,
  ];
}

function buildExpandAllButtonStyle(): PressableStyleFn {
  return ({ hovered, pressed }) => [
    styles.expandAllButton,
    (Boolean(hovered) || pressed) && styles.toggleButtonSelected,
  ];
}

function buildOverflowButtonStyle(): PressableStyleFn {
  return ({ hovered, pressed }) => [
    styles.overflowButton,
    (Boolean(hovered) || pressed) && styles.toggleButtonSelected,
  ];
}

function buildToggleButtonStyle(
  selected: boolean,
  baseStyles: StyleProp<ViewStyle> | StyleProp<ViewStyle>[],
): PressableStyleFn {
  return ({ hovered, pressed }) => [
    baseStyles,
    (selected || Boolean(hovered) || pressed) && styles.toggleButtonSelected,
  ];
}

function useChangesTreeState({
  workspaceId,
  cwd,
  files,
  viewMode,
  changesTabOpen,
  onViewModeChange,
}: {
  workspaceId?: string | null;
  cwd: string;
  files: ParsedDiffFile[];
  viewMode: "flat" | "tree";
  changesTabOpen: boolean;
  onViewModeChange: (viewMode: "flat" | "tree") => void;
}) {
  const workspaceStateKey = useMemo(
    () =>
      buildWorkspaceExplorerStateKey({
        workspaceId,
        workspaceRoot: cwd.trim(),
      }),
    [cwd, workspaceId],
  );
  const expandedPaths = usePanelStore((state) =>
    workspaceStateKey ? state.diffExpandedPathsByWorkspace[workspaceStateKey] : undefined,
  );
  const collapsedFolders = usePanelStore((state) =>
    workspaceStateKey ? state.diffCollapsedFoldersByWorkspace[workspaceStateKey] : undefined,
  );
  const setExpandedPaths = usePanelStore((state) => state.setDiffExpandedPathsForWorkspace);
  const setCollapsedFolders = usePanelStore((state) => state.setDiffCollapsedFoldersForWorkspace);
  const stableExpandedPaths = expandedPaths ?? EMPTY_PATH_LIST;
  const stableCollapsedFolders = collapsedFolders ?? EMPTY_PATH_LIST;
  const folderPaths = useMemo(
    () => collectDirPaths(compressSingleChildChains(buildDiffTree(files))),
    [files],
  );
  const folderPathSet = useMemo(() => new Set(folderPaths), [folderPaths]);
  const allExpanded = useMemo(() => {
    if (files.length === 0 || changesTabOpen) {
      return false;
    }
    const everyFileExpanded = files.every((file) => stableExpandedPaths.includes(file.path));
    const everyFolderExpanded =
      viewMode !== "tree" ||
      stableCollapsedFolders.every((folderPath) => !folderPathSet.has(folderPath));
    return everyFileExpanded && everyFolderExpanded;
  }, [changesTabOpen, files, folderPathSet, stableCollapsedFolders, stableExpandedPaths, viewMode]);
  const toggleViewMode = useCallback(() => {
    const nextViewMode = viewMode === "flat" ? "tree" : "flat";
    if (nextViewMode === "tree" && workspaceStateKey) {
      setCollapsedFolders(workspaceStateKey, []);
    }
    onViewModeChange(nextViewMode);
  }, [onViewModeChange, setCollapsedFolders, viewMode, workspaceStateKey]);
  const toggleExpandAll = useCallback(() => {
    if (!workspaceStateKey) {
      return;
    }
    if (allExpanded) {
      setExpandedPaths(workspaceStateKey, []);
      if (viewMode === "tree") {
        setCollapsedFolders(workspaceStateKey, folderPaths);
      }
      return;
    }
    setExpandedPaths(
      workspaceStateKey,
      files.map((file) => file.path),
    );
    if (viewMode === "tree") {
      setCollapsedFolders(workspaceStateKey, []);
    }
  }, [
    allExpanded,
    files,
    folderPaths,
    setCollapsedFolders,
    setExpandedPaths,
    viewMode,
    workspaceStateKey,
  ]);
  const updateExpandedPaths = useCallback(
    (paths: string[]) => {
      if (workspaceStateKey) {
        setExpandedPaths(workspaceStateKey, paths);
      }
    },
    [setExpandedPaths, workspaceStateKey],
  );
  const updateCollapsedFolders = useCallback(
    (paths: string[]) => {
      if (workspaceStateKey) {
        setCollapsedFolders(workspaceStateKey, paths);
      }
    },
    [setCollapsedFolders, workspaceStateKey],
  );
  const expandFilePaths = useCallback(
    (paths: string[]) => {
      if (!workspaceStateKey) return;
      setExpandedPaths(workspaceStateKey, paths);
      if (viewMode !== "tree") return;
      const nextCollapsedFolders = revealFileAncestorFolders(stableCollapsedFolders, paths);
      setCollapsedFolders(workspaceStateKey, nextCollapsedFolders);
    },
    [setCollapsedFolders, setExpandedPaths, stableCollapsedFolders, viewMode, workspaceStateKey],
  );

  return {
    expandedPaths: changesTabOpen ? EMPTY_PATH_LIST : stableExpandedPaths,
    collapsedFolders: stableCollapsedFolders,
    allExpanded,
    toggleViewMode,
    toggleExpandAll,
    expandFilePaths,
    updateExpandedPaths,
    updateCollapsedFolders,
  };
}

function useDiffTabNavigation({
  serverId,
  workspaceId,
  cwd,
  isMobile,
}: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  isMobile: boolean;
}) {
  const openWorkspaceTabFocused = useWorkspaceLayoutStore((state) => state.openTabFocused);
  const closeWorkspaceTab = useWorkspaceLayoutStore((state) => state.closeTab);
  const persistenceKey = useMemo(
    () =>
      buildWorkspaceTabPersistenceKey({
        serverId,
        workspaceId: workspaceId ?? cwd,
      }),
    [cwd, serverId, workspaceId],
  );
  const changesTabId = useWorkspaceLayoutStore((state) => {
    if (!persistenceKey) {
      return null;
    }
    const layout = state.layoutByWorkspace[persistenceKey];
    return (
      layout && collectAllTabs(layout.root).find((tab) => tab.target.kind === "working_diff")?.tabId
    );
  });
  const changesTabOpen = !isMobile && Boolean(changesTabId);
  const openChanges = useCallback(
    (path?: string) => {
      if (!persistenceKey || isMobile) {
        return;
      }
      openWorkspaceTabFocused(persistenceKey, {
        kind: "working_diff",
        ...(path ? { focusPath: path, focusRequestId: Date.now() } : {}),
      });
    },
    [isMobile, openWorkspaceTabFocused, persistenceKey],
  );
  const toggleChanges = useCallback(() => {
    if (!persistenceKey || isMobile) {
      return;
    }
    if (changesTabId) {
      closeWorkspaceTab(persistenceKey, changesTabId);
      return;
    }
    openChanges();
  }, [changesTabId, closeWorkspaceTab, isMobile, openChanges, persistenceKey]);
  const openCommit = useCallback(
    (sha: string) => {
      if (persistenceKey) {
        openWorkspaceTabFocused(persistenceKey, { kind: "commit_diff", sha });
      }
    },
    [openWorkspaceTabFocused, persistenceKey],
  );
  return {
    changesTabOpen,
    openChanges,
    toggleChanges,
    openCommit,
    onChangesFilePress: changesTabOpen ? openChanges : undefined,
  };
}

function DiffComparisonControls({
  diffMode,
  committedDescription,
  showCompactBaseSelector,
  serverId,
  cwd,
  currentBranchName,
  baseSelection,
  onSelectComparisonBase,
  onSelectUncommitted,
  onSelectBase,
}: {
  diffMode: "uncommitted" | "base";
  committedDescription?: string;
  showCompactBaseSelector: boolean;
  serverId: string;
  cwd: string;
  currentBranchName: string | null;
  baseSelection: ReturnType<typeof useWorkingDiff>["baseSelection"];
  onSelectComparisonBase: (baseRef: string | null) => Promise<void>;
  onSelectUncommitted: () => void;
  onSelectBase: () => void;
}) {
  return (
    <View style={styles.diffComparisonControls}>
      <DiffModeMenu
        diffMode={diffMode}
        committedDescription={committedDescription}
        onSelectUncommitted={onSelectUncommitted}
        onSelectBase={onSelectBase}
      />
      <ChangesBaseSelectorPlacement
        visible={showCompactBaseSelector}
        serverId={serverId}
        cwd={cwd}
        currentBranchName={currentBranchName}
        baseSelection={baseSelection}
        onSelect={onSelectComparisonBase}
      />
    </View>
  );
}

function ChangesBaseSelectorPlacement({
  visible,
  serverId,
  cwd,
  currentBranchName,
  baseSelection,
  onSelect,
}: {
  visible: boolean;
  serverId: string;
  cwd: string;
  currentBranchName: string | null;
  baseSelection: ReturnType<typeof useWorkingDiff>["baseSelection"];
  onSelect: (baseRef: string | null) => Promise<void>;
}) {
  if (!visible || !currentBranchName) {
    return null;
  }
  return (
    <ChangesBaseSelector
      serverId={serverId}
      cwd={cwd}
      currentBranch={currentBranchName}
      recordedBaseRef={baseSelection.recordedBaseRef}
      selectedBaseRef={baseSelection.selectedBaseRef}
      effectiveBaseRef={baseSelection.effectiveBaseRef}
      supported={baseSelection.supported}
      onSelect={onSelect}
    />
  );
}

function ChangesUncommittedBadge({
  currentBranchName,
  hasUncommittedChanges,
}: {
  currentBranchName: string | null;
  hasUncommittedChanges: boolean;
}) {
  const { t } = useTranslation();
  if (!currentBranchName || !hasUncommittedChanges) {
    return null;
  }
  return (
    <StatusBadge
      label={t("workspace.git.diff.uncommitted")}
      variant="muted"
      testID="changes-uncommitted-badge"
    />
  );
}

export function GitDiffPane({
  serverId,
  workspaceId,
  cwd,
  enabled,
  onOpenFile,
  onAddToChat,
}: GitDiffPaneProps) {
  const { settings: appSettings } = useAppSettings();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const canUseSplitLayout = supportsSplitDiffLayout(isMobile);
  const { preferences: changesPreferences, updatePreferences: updateChangesPreferences } =
    useChangesPreferences();
  const wrapLines = changesPreferences.wrapLines;
  const viewMode = changesPreferences.viewMode;
  const effectiveLayout = resolveDiffLayout(changesPreferences.layout, canUseSplitLayout);

  const handleToggleWrapLines = useCallback(() => {
    void updateChangesPreferences({ wrapLines: !wrapLines });
  }, [updateChangesPreferences, wrapLines]);

  const handleToggleHideWhitespace = useCallback(() => {
    void updateChangesPreferences({
      hideWhitespace: !changesPreferences.hideWhitespace,
    });
  }, [changesPreferences.hideWhitespace, updateChangesPreferences]);

  const handleToggleLayout = useCallback(() => {
    void updateChangesPreferences({
      layout: changesPreferences.layout === "unified" ? "split" : "unified",
    });
  }, [changesPreferences.layout, updateChangesPreferences]);

  const codeFontSize = appSettings.codeFontSize;
  const layoutToggleStyle = useMemo(
    () => buildToggleButtonStyle(false, styles.expandAllButton),
    [],
  );

  const viewModeToggleStyle = useMemo(
    () => buildToggleButtonStyle(viewMode === "tree", styles.expandAllButton),
    [viewMode],
  );

  const expandAllToggleStyle = useMemo(() => buildExpandAllButtonStyle(), []);

  const overflowToggleStyle = useMemo(() => buildOverflowButtonStyle(), []);

  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { targets: desktopOpenTargets } = useDesktopOpenTargets({
    isLocalExecution: isLocalDaemon,
  });
  const fileManagerTarget = desktopOpenTargets.find((target) => target.kind === "file-manager");
  const {
    changesTabOpen,
    toggleChanges: handleToggleChangesTab,
    openCommit: handleCommitPress,
    onChangesFilePress,
  } = useDiffTabNavigation({ serverId, workspaceId, cwd, isMobile });
  const workspaceKey = useMemo(
    () =>
      buildWorkspaceTabPersistenceKey({
        serverId,
        workspaceId: workspaceId ?? cwd,
      }),
    [cwd, serverId, workspaceId],
  );
  const inlineNavigation = useInlineChangesNavigationTarget();
  const refreshSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client);
  // COMPAT(fsEntryDuplicate): added in v0.3.0, remove gate after 2027-02-09.
  const fsEntryDuplicateEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fsEntryDuplicate === true,
  );
  const fileEditingSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.workspaceFileEditing === true,
  );
  const runRefresh = useCheckoutGitActionsStore((s) => s.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "refresh" })) ===
    "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const {
    status,
    isStatusLoading,
    isGit,
    notGit,
    statusErrorMessage,
    baseRef,
    comparisonBaseRef,
    baseSelection,
    currentBranchName,
    hasUncommittedChanges,
    diffMode,
    selectUncommitted: handleSelectUncommitted,
    selectBase: handleSelectBase,
    files,
    sourceFiles,
    diffPayloadError,
    diffTooLarge,
    isDiffLoading,
    reviewActions,
    reviewDraftKey,
    contextExpansion,
    contextExpansionSupported,
    fileReviews,
  } = useWorkingDiff({
    serverId,
    workspaceId: workspaceId ?? undefined,
    cwd,
    ignoreWhitespace: changesPreferences.hideWhitespace,
    enabled: enabled !== false,
    requestedNavigationLine: inlineNavigation.requestedLine,
  });
  usePublishInlineChangesNavigation({
    workspaceKey,
    enabled,
    changesTabOpen,
    files: sourceFiles,
    isLoading: isDiffLoading,
    contextExpansionSupported,
    navigate: inlineNavigation.navigate,
  });
  const reviewAttachment = useReviewAttachmentSnapshot({
    key: reviewDraftKey,
    diffFiles: files,
    cwd,
    mode: diffMode,
    baseRef,
  });
  useEffect(() => {
    const error = reviewActions.suggestionRangeError;
    if (!error) return;
    let messageKey:
      | "review.suggestion.rangeInvalid"
      | "review.suggestion.rangeHidden"
      | "review.suggestion.rangeTooLarge" = "review.suggestion.rangeInvalid";
    if (error === "hidden-lines") {
      messageKey = "review.suggestion.rangeHidden";
    } else if (error === "too-large") {
      messageKey = "review.suggestion.rangeTooLarge";
    }
    toast.error(t(messageKey));
    reviewActions.onClearSuggestionRangeError();
  }, [reviewActions, reviewActions.suggestionRangeError, t, toast]);
  const handleExpandContext = useCallback(
    (filePath: string, region: DiffContextRegion, direction: "up" | "down" | "all") =>
      contextExpansion.expand(filePath, region, direction).catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.diff.context.failedToExpand"),
        );
      }),
    [contextExpansion, t, toast],
  );
  const handleExpandFile = useCallback(
    (filePath: string) =>
      contextExpansion.expandFile(filePath).catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.diff.context.failedToExpand"),
        );
      }),
    [contextExpansion, t, toast],
  );
  usePublishWorkingDiffAttachment({
    serverId,
    workspaceId: workspaceId ?? undefined,
    cwd,
    attachment: reviewAttachment,
    enabled: !changesTabOpen,
  });
  const {
    githubFeaturesEnabled,
    forge,
    authState,
    payloadError: prPayloadError,
  } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });
  const forgeProvidersSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.forgeProviders === true,
  );
  const forgeSetupAction = computeForgeSetupAction({
    forge,
    forgeProvidersSupported,
    authState,
  });
  const forgeSetupMessage = useMemo(
    () =>
      buildForgeSetupMessage({
        action: forgeSetupAction,
        forge,
        host: parseForgeHost(status?.remoteUrl),
        t,
      }),
    [forgeSetupAction, forge, status?.remoteUrl, t],
  );
  const handleViewModeChange = useCallback(
    (nextViewMode: "flat" | "tree") => {
      void updateChangesPreferences({ viewMode: nextViewMode });
    },
    [updateChangesPreferences],
  );
  const changesTree = useChangesTreeState({
    workspaceId,
    cwd,
    files,
    viewMode,
    changesTabOpen,
    onViewModeChange: handleViewModeChange,
  });
  const handleToggleAllFileReviews = useCallback(() => {
    const allReviewed =
      fileReviews.reviewableCount > 0 && fileReviews.reviewedCount === fileReviews.reviewableCount;
    if (allReviewed) {
      fileReviews.clearAll();
      return;
    }
    fileReviews.markAll();
    changesTree.updateExpandedPaths([]);
  }, [changesTree, fileReviews]);
  const handleExpandUnreviewedFiles = useCallback(() => {
    const filePaths = files.map((file) => file.path);
    const unreviewedPaths = expandOnlyUnreviewedFiles(filePaths, fileReviews.reviewedPaths);
    changesTree.expandFilePaths(unreviewedPaths);
  }, [changesTree, fileReviews.reviewedPaths, files]);
  const sharedDisplayPreferences = useMemo(
    () => ({
      layout: effectiveLayout,
      wrapLines,
      codeFontSize,
      monoFontFamily: appSettings.monoFontFamily,
    }),
    [appSettings.monoFontFamily, codeFontSize, effectiveLayout, wrapLines],
  );
  const downloadFile = useFileDownload({
    serverId,
    workspaceId,
    workspaceRoot: cwd,
  });
  const handleCopyPath = useCallback(
    (path: string) => {
      void Clipboard.setStringAsync(
        buildAbsoluteExplorerPath({ workspaceRoot: cwd, entryPath: path }),
      );
    },
    [cwd],
  );
  const handleCopyRelativePath = useCallback((path: string) => {
    void Clipboard.setStringAsync(path);
  }, []);
  const handleRevealPath = useCallback(
    async (path: string) => {
      if (!fileManagerTarget) {
        return;
      }
      try {
        await openDesktopTarget({
          editorId: fileManagerTarget.id,
          workspacePath: cwd,
          filePath: buildAbsoluteExplorerPath({
            workspaceRoot: cwd,
            entryPath: path,
          }),
        });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.revealFailed"),
        );
      }
    },
    [cwd, fileManagerTarget, t, toast],
  );
  const handleDownloadPath = useCallback(
    (path: string) => {
      downloadFile({ fileName: path.split("/").pop() ?? path, path });
    },
    [downloadFile],
  );
  const handleDuplicatePath = useCallback(
    async (path: string) => {
      if (!client) {
        return;
      }
      try {
        const payload = await client.duplicateFileEntry({ cwd, path });
        if (!payload.success) {
          toast.error(payload.error ?? t("workspace.fileExplorer.errors.duplicateFailed"));
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [client, cwd, t, toast],
  );
  const onRevertPath = useDiscardChangesAction({ serverId, cwd, diffMode });
  const handleEditLine = useCallback(
    (line: ReviewableChangedLine) => {
      const lineStart = line.target.editLineNumber;
      if (!lineStart) return;
      onOpenFile?.(line.target.filePath, { lineStart, openMode: "source" });
    },
    [onOpenFile],
  );
  const handleOpenLspDefinition = useCallback(
    (location: { path: string; lineStart: number; lineEnd: number }) => {
      onOpenFile?.(location.path, { ...location, openMode: "source" });
    },
    [onOpenFile],
  );
  const changesLsp = useChangesLsp({
    serverId,
    cwd,
    active: enabled !== false && !changesTabOpen,
    dirty: hasUncommittedChanges,
    loadSource: contextExpansion.loadSource,
    onOpenDefinition: handleOpenLspDefinition,
  });
  const handleToggleChangesLsp = useCallback(() => {
    changesLsp.setEnabled(!changesLsp.preferenceEnabled);
  }, [changesLsp]);
  const workingTreeMode = useMemo(
    () => ({
      kind: "working_tree" as const,
      viewMode,
      expandedPaths: changesTree.expandedPaths,
      collapsedFolders: changesTree.collapsedFolders,
      reviewActions,
      fileReviews,
      keyboardEnabled: enabled !== false && !changesTabOpen,
      focusShortcutEnabled: enabled !== false && !changesTabOpen,
      ...inlineNavigation.focus,
      onEditLine: resolveEditLineHandler(onOpenFile, fileEditingSupported, handleEditLine),
      onFilePress: onChangesFilePress,
      workspaceFileDragScope: workspaceId ? { serverId, workspaceId } : undefined,
      onOpenFile,
      onAddToChat,
      onCopyPath: handleCopyPath,
      onCopyRelativePath: handleCopyRelativePath,
      onReveal: fileManagerTarget ? handleRevealPath : undefined,
      revealTargetName: fileManagerTarget?.label,
      onDownload: handleDownloadPath,
      onDuplicate: fsEntryDuplicateEnabled ? handleDuplicatePath : undefined,
      onRevert: onRevertPath,
      onExpandContext: contextExpansionSupported ? handleExpandContext : undefined,
      onExpandFile: contextExpansionSupported ? handleExpandFile : undefined,
      expandingFilePaths: contextExpansion.expandingFilePaths,
      onSearch: contextExpansionSupported ? contextExpansion.search : undefined,
      lsp: changesLsp,
      onExpandedPathsChange: changesTree.updateExpandedPaths,
      onCollapsedFoldersChange: changesTree.updateCollapsedFolders,
    }),
    [
      enabled,
      changesTabOpen,
      inlineNavigation.focus,
      viewMode,
      changesTree.expandedPaths,
      changesTree.collapsedFolders,
      reviewActions,
      fileReviews,
      fileEditingSupported,
      onChangesFilePress,
      serverId,
      workspaceId,
      onOpenFile,
      handleEditLine,
      onAddToChat,
      handleCopyPath,
      handleCopyRelativePath,
      handleDownloadPath,
      handleDuplicatePath,
      handleRevealPath,
      fileManagerTarget,
      fsEntryDuplicateEnabled,
      onRevertPath,
      contextExpansionSupported,
      handleExpandContext,
      handleExpandFile,
      contextExpansion.expandingFilePaths,
      contextExpansion.search,
      changesLsp,
      changesTree.updateExpandedPaths,
      changesTree.updateCollapsedFolders,
    ],
  );

  const hasChanges = files.length > 0;
  const diffErrorMessage = diffPayloadError?.message ?? null;
  const prErrorMessage = computePrErrorMessage(githubFeaturesEnabled, prPayloadError);
  const baseRefLabel = useMemo(
    () => computeBaseRefLabel(baseRef, t("workspace.git.diff.base")),
    [baseRef, t],
  );
  const { gitActions, branchLabel } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });
  const committedDiffDescription = useMemo(
    () => computeCommittedDiffDescription(branchLabel, baseRefLabel),
    [baseRefLabel, branchLabel],
  );
  const emptyMessage = computeEmptyMessage(
    changesPreferences.hideWhitespace,
    diffMode,
    baseRefLabel,
    {
      hiddenWhitespace: t("workspace.git.diff.emptyHiddenWhitespace"),
      uncommitted: t("workspace.git.diff.emptyUncommitted"),
      againstBase: (label) => t("workspace.git.diff.emptyAgainstBase", { baseRef: label }),
    },
  );
  const handleSelectComparisonBase = useCallback(
    (nextBaseRef: string | null) =>
      applyChangesBaseSelection({
        baseRef: nextBaseRef,
        setOverride: baseSelection.setOverride,
        showCommitted: handleSelectBase,
      }),
    [baseSelection.setOverride, handleSelectBase],
  );
  const bodyContent: ReactElement = (
    <DiffBodyContent
      isStatusLoading={isStatusLoading}
      statusErrorMessage={statusErrorMessage}
      notGit={notGit}
      isDiffLoading={isDiffLoading}
      diffErrorMessage={diffErrorMessage}
      diffTooLarge={diffTooLarge}
      hasChanges={hasChanges}
      emptyMessage={emptyMessage}
      checkingRepositoryLabel={t("workspace.git.diff.checkingRepository")}
      notRepositoryLabel={t("workspace.git.diff.notRepository")}
    >
      <SharedDiffView
        files={files}
        displayPreferences={sharedDisplayPreferences}
        mode={workingTreeMode}
      />
    </DiffBodyContent>
  );

  return (
    <View
      {...{
        onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
      }}
      style={styles.container}
    >
      {isGit && (currentBranchName || isMobile) ? (
        <View style={styles.header} testID="changes-header">
          <View style={styles.headerSelectors}>
            <BranchSwitcher
              currentBranchName={currentBranchName}
              serverId={serverId}
              workspaceId={workspaceId ?? cwd}
              workspaceDirectory={cwd}
              isGitCheckout={isGit}
              testID="changes-branch-switcher"
            />
            <ChangesUncommittedBadge
              currentBranchName={currentBranchName}
              hasUncommittedChanges={hasUncommittedChanges}
            />
            <ChangesBaseSelectorPlacement
              visible={!isMobile}
              serverId={serverId}
              cwd={cwd}
              currentBranchName={currentBranchName}
              baseSelection={baseSelection}
              onSelect={handleSelectComparisonBase}
            />
          </View>
          {isMobile ? <GitActionsSplitButton gitActions={gitActions} /> : null}
        </View>
      ) : null}

      {isGit ? (
        <View style={styles.diffStatusContainer}>
          <View style={styles.diffStatusInner}>
            <DiffComparisonControls
              diffMode={diffMode}
              committedDescription={committedDiffDescription}
              showCompactBaseSelector={isMobile}
              serverId={serverId}
              cwd={cwd}
              currentBranchName={currentBranchName}
              baseSelection={baseSelection}
              onSelectComparisonBase={handleSelectComparisonBase}
              onSelectUncommitted={handleSelectUncommitted}
              onSelectBase={handleSelectBase}
            />
            <View style={styles.diffStatusButtons}>
              <ChangesTabToggle
                isMobile={isMobile}
                selected={changesTabOpen}
                onPress={handleToggleChangesTab}
              />
              {canUseSplitLayout && !changesTabOpen ? (
                <DiffLayoutToggle
                  layout={changesPreferences.layout}
                  isMobile={isMobile}
                  toggleStyle={layoutToggleStyle}
                  onToggle={handleToggleLayout}
                />
              ) : null}
              <FileReviewBulkToggle
                fileReviews={fileReviews}
                isMobile={isMobile}
                visible={files.length > 0}
                testID="changes-toggle-file-reviews"
                onToggle={handleToggleAllFileReviews}
              />
              {files.length > 0 ? (
                <DiffViewModeToggle
                  viewMode={viewMode}
                  isMobile={isMobile}
                  toggleStyle={viewModeToggleStyle}
                  onToggle={changesTree.toggleViewMode}
                />
              ) : null}
              {files.length > 0 && !changesTabOpen ? (
                <DiffFilesToolbar
                  allFileDiffsExpanded={changesTree.allExpanded}
                  canExpandUnreviewed={fileReviews.available}
                  isMobile={isMobile}
                  expandUnreviewedTestID="changes-expand-unreviewed-files"
                  expandAllToggleStyle={expandAllToggleStyle}
                  onToggleExpandAll={changesTree.toggleExpandAll}
                  onExpandUnreviewed={handleExpandUnreviewedFiles}
                />
              ) : null}
              <DiffOptionsMenu
                brand={getForgePresentation(forge).brandLabel}
                hideWhitespace={changesPreferences.hideWhitespace}
                isMobile={isMobile}
                isRefreshing={isRefreshing}
                overflowToggleStyle={overflowToggleStyle}
                refreshSupported={refreshSupported}
                wrapLines={wrapLines}
                lspSupported={changesLsp.supported}
                lspEnabled={changesLsp.preferenceEnabled}
                lspPaused={changesLsp.paused}
                onRefresh={handleRefresh}
                onToggleHideWhitespace={handleToggleHideWhitespace}
                onToggleWrapLines={handleToggleWrapLines}
                onToggleLsp={handleToggleChangesLsp}
              />
            </View>
          </View>
        </View>
      ) : null}

      {forgeSetupMessage ? (
        <View style={styles.forgeSetupCallout} testID="forge-setup-callout">
          <Text style={styles.forgeSetupCalloutText}>{forgeSetupMessage}</Text>
        </View>
      ) : null}

      {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}

      <View style={styles.diffContainer}>{bodyContent}</View>

      <CommitsSection
        serverId={serverId}
        cwd={cwd}
        baseRef={comparisonBaseRef}
        onCommitPress={handleCommitPress}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  contextControl: {
    minHeight: theme.lineHeight.diff,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  contextControlButton: {
    width: 24,
    height: DIFF_CONTEXT_CONTROL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  contextControlLabelButton: {
    minHeight: DIFF_CONTEXT_CONTROL_HEIGHT,
    paddingHorizontal: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  contextControlButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  contextControlText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  container: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerSelectors: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  diffStatusContainer: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  diffStatusInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: theme.spacing[3],
  },
  diffComparisonControls: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  diffModeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    // Align text with header branch icon (at spacing[3] from edge, minus our horizontal padding)
    marginLeft: theme.spacing[3] - theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    height: {
      xs: 28,
      sm: 28,
      md: 24,
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  diffModeTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  diffModeTriggerPressed: {
    backgroundColor: theme.colors.surface2,
  },
  diffStatusRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  diffStatusText: {
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.25,
    color: theme.colors.foregroundMuted,
  },
  diffStatusIconHidden: {
    opacity: 0,
  },
  diffStatusButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
  },
  toggleButtonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  expandAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    minWidth: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    paddingHorizontal: {
      xs: theme.spacing[2],
      sm: theme.spacing[2],
      md: theme.spacing[1],
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  overflowButton: {
    width: ICON_SIZE.sm + 2 * SPACING[1],
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  actionErrorText: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  forgeSetupCallout: {
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  forgeSetupCalloutText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  diffContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  scrollView: {
    flex: 1,
  },
  diffReviewSurface: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  changesSearchBar: {
    position: "absolute",
    left: theme.spacing[3],
    right: theme.spacing[3],
    bottom: theme.spacing[3],
    zIndex: 20,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  changesSearchPrompt: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  changesSearchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[2],
  },
  changesSearchPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  changesSearchStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  changesLspHover: {
    position: "absolute",
    zIndex: 30,
    maxWidth: 560,
    maxHeight: 280,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  changesLspHoverText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  lineReviewShortcutHint: {
    position: "absolute",
    left: theme.spacing[3],
    right: theme.spacing[3],
    bottom: theme.spacing[3],
    alignItems: "center",
  },
  lineReviewShortcutHintText: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.border,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.xs,
  },
  contentContainer: {
    paddingBottom: theme.spacing[8],
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    gap: theme.spacing[4],
  },
  loadingText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[6],
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.foregroundMuted,
  },
  fileSection: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileSectionHeaderContainer: {
    overflow: "hidden",
  },
  fileSectionHeaderExpanded: {
    backgroundColor: theme.colors.surface1,
  },
  fileSectionBodyContainer: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  fileSectionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[3],
    paddingRight: WORKSPACE_FILE_ROW_TRAILING_PADDING,
    paddingVertical: WORKSPACE_FILE_ROW_VERTICAL_PADDING,
    gap: theme.spacing[1],
    minWidth: 0,
    zIndex: 2,
    elevation: 2,
  },
  fileHeaderActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  fileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  fileHeaderLeftTree: {
    gap: WORKSPACE_TREE_ICON_LABEL_GAP,
  },
  fileHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  fileReviewButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  fileReviewControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  lineReviewButton: {
    width: 22,
    minWidth: 22,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  lineReviewFocusMarker: {
    position: "absolute",
    left: 1,
    width: 3,
    height: 10,
    borderRadius: 2,
    backgroundColor: theme.colors.accent,
  },
  lineReviewGutterContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
  },
  lineReviewGutterSlot: {
    width: LINE_REVIEW_GUTTER_WIDTH,
    minWidth: LINE_REVIEW_GUTTER_WIDTH,
    alignItems: "stretch",
    justifyContent: "center",
  },
  selectedReviewLine: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.accent,
    backgroundColor: theme.colors.surface3,
  },
  diffNavigationHighlight: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.accentBright,
    backgroundColor: theme.colors.surface3,
  },
  fileReviewButtonDisabled: {
    opacity: 0.45,
  },
  fileReviewProgress: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  fileIcon: {
    width: WORKSPACE_TREE_ICON_SIZE,
    height: WORKSPACE_TREE_ICON_SIZE,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  fileName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
    userSelect: "none",
  },
  fileDir: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flex: 1,
    minWidth: 0,
    userSelect: "none",
  },
  fileDirSpacer: {
    flex: 1,
    minWidth: 0,
  },
  diffContent: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  diffContentRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  diffContentInner: {
    flexDirection: "column",
  },
  linesContainer: {
    backgroundColor: theme.colors.surface1,
  },
  gutterColumn: {
    backgroundColor: theme.colors.surface1,
    zIndex: 4,
    elevation: 4,
    overflow: "visible",
  },
  gutterCell: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    justifyContent: "flex-start",
    zIndex: 4,
    elevation: 4,
    overflow: "visible",
  },
  inlineReviewRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surface1,
  },
  inlineReviewGutterSpacer: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    flexShrink: 0,
  },
  textLineContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingLeft: theme.spacing[2],
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  splitColumnScroll: {
    flex: 1,
  },
  splitHeaderRow: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[3],
  },
  splitCell: {
    flex: 1,
    flexBasis: 0,
    backgroundColor: theme.colors.surface2,
  },
  splitCellRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  emptySplitCell: {
    backgroundColor: theme.colors.surfaceDiffEmpty,
  },
  splitCellWithDivider: {
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  diffLineContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "visible",
  },
  lineNumberGutter: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    marginRight: theme.spacing[2],
    alignSelf: "stretch",
    justifyContent: "flex-start",
    zIndex: 4,
    elevation: 4,
    overflow: "visible",
  },
  diffTextMetrics: {
    fontSize: theme.fontSize.code,
    lineHeight: theme.lineHeight.diff,
    fontFamily: theme.fontFamily.mono,
  },
  lineNumberText: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    paddingRight: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    userSelect: "none",
  },
  addLineNumberText: {
    color: theme.colors.diffAddition,
  },
  removeLineNumberText: {
    color: theme.colors.diffDeletion,
  },
  diffLineText: {
    flex: 1,
    paddingRight: theme.spacing[3],
    color: theme.colors.foreground,
    userSelect: "text",
  },
  addLineContainer: {
    backgroundColor: "rgba(46, 160, 67, 0.15)", // GitHub green
  },
  addLineText: {
    color: theme.colors.foreground,
  },
  removeLineContainer: {
    backgroundColor: "rgba(248, 81, 73, 0.1)", // GitHub red
  },
  removeLineText: {
    color: theme.colors.foreground,
  },
  headerLineContainer: {
    backgroundColor: theme.colors.surface2,
  },
  headerLineText: {
    color: theme.colors.foregroundMuted,
  },
  contextLineContainer: {
    backgroundColor: theme.colors.surface1,
  },
  suggestionSelectionLine: {
    backgroundColor: "rgba(10, 132, 255, 0.22)",
  },
  contextLineText: {
    color: theme.colors.foregroundMuted,
  },
  emptySplitCellText: {
    color: "transparent",
  },
  statusMessageContainer: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[4],
  },
  statusMessageText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));

const DIFF_HEIGHT_CHANGE_EPSILON = 0.5;
