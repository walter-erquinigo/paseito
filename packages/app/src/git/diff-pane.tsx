import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  ListChevronsDownUp,
  ListChevronsUpDown,
  ListTodo,
  Maximize2,
  Pilcrow,
  RotateCw,
  Square,
  SquareCheckBig,
  ListChecks,
  WrapText,
} from "lucide-react-native";
import { type ParsedDiffFile, type DiffLine, type HighlightToken } from "@/git/use-diff-query";
import { buildDiffFlatItems, sumHeightsBefore, type DiffFlatItem } from "@/git/diff-flat-items";
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useOverlayFlatListScrollbar } from "@/components/ui/overlay-scrollbar/use-overlay-flat-list-scrollbar";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { usePanelStore } from "@/stores/panel-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
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
import { ChangesBaseSelector } from "@/git/changes-base-selector";
import { applyChangesBaseSelection } from "@/git/changes-base-selection";
import { parseDiffContextMarker, type DiffContextRegion } from "@/git/diff-context-expansion";
import {
  collapseReviewedFile,
  expandOnlyUnreviewedFiles,
  expandInvalidatedFiles,
  expandUnreviewedFile,
  revealFileAncestorFolders,
} from "@/git/file-review-expansion";
import {
  findNextUncheckedLine,
  getLineReviewKeyboardAction,
  isReviewTargetFullyVisible,
} from "@/review/line-review-navigation";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

export function resolveDiffLayout(
  layout: "unified" | "split",
  canUseSplitLayout: boolean,
): "unified" | "split" {
  return canUseSplitLayout ? layout : "unified";
}

function fileHeaderPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.fileHeader, (Boolean(hovered) || pressed) && styles.fileHeaderActive];
}

interface HighlightedTextProps {
  tokens: HighlightToken[];
  textMetricsStyle: TextStyle;
  wrapLines?: boolean;
  testID?: string;
}

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
    <Text style={containerStyle} testID={testID}>
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
  /** Tree indentation level (0 on the flat/mobile path). */
  depth?: number;
  /** Show the muted directory suffix (flat list); false inside the folder tree. */
  showDir?: boolean;
  interactive?: boolean;
  onToggle?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onAddToChat?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onDownload?: (path: string) => void;
  onHeaderHeightChange?: (path: string, height: number) => void;
  fileReviews?: FileReviewActions;
  onToggleReviewed?: (path: string) => void;
  testID?: string;
}

const EMPTY_COMMENTS: readonly ReviewDraftComment[] = [];

function noopStartComment(): void {}

function isSuggestionTargetSelected(
  reviewTarget: ReviewableDiffTarget | null | undefined,
  reviewActions: InlineReviewActions | undefined,
): boolean {
  return Boolean(reviewTarget && reviewActions?.selectedSuggestionTargetKeys.has(reviewTarget.key));
}

const DIFF_LINE_HOVER_STYLE = isWeb ? ({ cursor: "auto" } as const) : null;
const DIFF_REVIEW_SURFACE_DATASET = { paseitoDiffReviewSurface: "true" } as const;
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
    return <View style={rowStyle}>{children}</View>;
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
      isSuggestionTargetSelected(reviewTarget, reviewActions) && styles.suggestionSelectionLine,
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
          {t("workspace.git.diff.context.hiddenLines", { count: region.lineCount })}
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
    <Text style={textStyle} testID={textTestID}>
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
      isSuggestionTargetSelected(reviewTarget, reviewActions) && styles.suggestionSelectionLine,
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
      isSuggestionTargetSelected(line?.reviewTarget, reviewActions) &&
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
        <Text style={textStyle}>{formatDiffContentText(line?.content)}</Text>
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
      isSuggestionTargetSelected(reviewTarget, reviewActions) && styles.suggestionSelectionLine,
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
      isSuggestionTargetSelected(line?.reviewTarget, reviewActions) &&
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
        <Text style={textStyle}>{formatDiffContentText(line?.content)}</Text>
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
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
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
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
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
  const threadState = getInlineReviewThreadState({ reviewTarget, reviewActions });
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
                      inlineUnistylesStyle({ minHeight: contextControlRowHeight }),
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
                      inlineUnistylesStyle({ minHeight: contextControlRowHeight }),
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
  depth = 0,
  showDir = true,
  interactive = true,
  onToggle,
  onOpenFile,
  onAddToChat,
  onCopyPath,
  onDownload,
  onHeaderHeightChange,
  fileReviews,
  onToggleReviewed,
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
  const pressInRef = useRef<{ ts: number; pageX: number; pageY: number } | null>(null);

  const toggleExpanded = useCallback(() => {
    if (!interactive) {
      return;
    }
    pressHandledRef.current = true;
    onToggle?.(file.path);
  }, [file.path, interactive, onToggle]);

  const handleOpenFile = useCallback(() => {
    onOpenFile?.(file.path);
  }, [file.path, onOpenFile]);

  const handleAddToChat = useCallback(() => {
    onAddToChat?.(file.path);
  }, [file.path, onAddToChat]);

  const handleCopyPath = useCallback(() => {
    onCopyPath?.(file.path);
  }, [file.path, onCopyPath]);

  const handleDownload = useCallback(() => {
    onDownload?.(file.path);
  }, [file.path, onDownload]);

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
  }, []);

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

  const headerPressableStyle = useCallback(
    (state: PressableStateCallbackType) =>
      depth > 0
        ? [
            fileHeaderPressableStyle(state),
            inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(depth) }),
          ]
        : fileHeaderPressableStyle(state),
    [depth],
  );

  const fileName = file.path.split("/").pop() ?? file.path;
  const headerContent = (
    <>
      <View
        ref={dragSourceRef}
        style={showDir ? styles.fileHeaderLeft : [styles.fileHeaderLeft, styles.fileHeaderLeftTree]}
      >
        {showDir ? null : (
          <View style={styles.fileIcon}>
            <MaterialFileIcon fileName={fileName} size={16} />
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
      <View style={headerPressableStyle({ hovered: false, pressed: false })}>{headerContent}</View>
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
        onPress={toggleExpanded}
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
          <FileActionsContextMenuContent
            fileKind="file"
            fileExists={!file.isDeleted}
            onOpenFile={onOpenFile ? handleOpenFile : undefined}
            onCopyPath={onCopyPath ? handleCopyPath : undefined}
            onDownload={onDownload ? handleDownload : undefined}
            onAddToChat={onAddToChat ? handleAddToChat : undefined}
            testIDPrefix={testID}
          />
        ) : null}
      </ContextMenu>
    </View>
  );
});

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
  ) => void;
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

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean; open?: boolean },
) => StyleProp<ViewStyle>;

const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const reviewedIconColorMapping = (theme: Theme) => ({ color: theme.colors.success });

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
  onRefresh?: () => void;
  onToggleHideWhitespace: () => void;
  onToggleWrapLines: () => void;
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
  onRefresh,
  onToggleHideWhitespace,
  onToggleWrapLines,
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
        onDownload?: (path: string) => void;
        onEditLine?: (line: ReviewableChangedLine) => void;
        onExpandContext?: (
          filePath: string,
          region: DiffContextRegion,
          direction: "up" | "down" | "all",
        ) => void;
        onExpandedPathsChange: (paths: string[]) => void;
        onCollapsedFoldersChange: (paths: string[]) => void;
        keyboardEnabled?: boolean;
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
        onExpandContext?: (
          filePath: string,
          region: DiffContextRegion,
          direction: "up" | "down" | "all",
        ) => void;
      }
    | {
        kind: "commit";
      };
}

export function SharedDiffView({ files, displayPreferences, mode }: SharedDiffViewProps) {
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const toast = useToast();
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
  const viewMode = mode.kind === "working_tree" ? mode.viewMode : "flat";
  const expandedPathsArray = useMemo(() => {
    if (mode.kind === "working_tree") {
      return mode.expandedPaths;
    }
    if (mode.kind === "working_tab" && mode.expandedPaths !== null) {
      return mode.expandedPaths;
    }
    return files.map((file) => file.path);
  }, [files, mode]);
  const expandedPaths = useMemo(() => new Set(expandedPathsArray), [expandedPathsArray]);
  const collapsedFoldersArray =
    mode.kind === "working_tree" ? mode.collapsedFolders : EMPTY_PATH_LIST;
  const collapsedFolders = useMemo(() => new Set(collapsedFoldersArray), [collapsedFoldersArray]);
  const stickyHeaders = mode.kind !== "commit";
  const interactive = mode.kind !== "commit";
  const reviewActions = mode.kind === "commit" ? undefined : mode.reviewActions;
  const fileReviews = mode.kind === "commit" ? undefined : mode.fileReviews;
  const onFilePress = mode.kind === "working_tree" ? mode.onFilePress : undefined;
  const focusPath = mode.kind === "working_tab" ? mode.focusPath : undefined;
  const focusRequestId = mode.kind === "working_tab" ? mode.focusRequestId : undefined;
  const focusLineStart = mode.kind === "working_tab" ? mode.focusLineStart : undefined;
  const focusLineEnd = mode.kind === "working_tab" ? mode.focusLineEnd : undefined;
  const focusColumn = mode.kind === "working_tab" ? mode.focusColumn : undefined;
  const navigationHighlight = useMemo<DiffNavigationHighlight | undefined>(() => {
    if (!focusPath || !focusLineStart) return undefined;
    return {
      filePath: focusPath,
      lineStart: focusLineStart,
      lineEnd: Math.max(focusLineStart, focusLineEnd ?? focusLineStart),
    };
  }, [focusLineEnd, focusLineStart, focusPath]);
  const onOpenFile = mode.kind === "working_tree" ? mode.onOpenFile : undefined;
  const onAddToChat = mode.kind === "working_tree" ? mode.onAddToChat : undefined;
  const workspaceFileDragScope =
    mode.kind === "working_tree" ? mode.workspaceFileDragScope : undefined;
  const onCopyPath = mode.kind === "working_tree" ? mode.onCopyPath : undefined;
  const onDownload = mode.kind === "working_tree" ? mode.onDownload : undefined;
  const onEditLine = mode.kind === "commit" ? undefined : mode.onEditLine;
  const keyboardEnabled = mode.kind !== "commit" && mode.keyboardEnabled !== false;
  const onExpandContext = mode.kind === "commit" ? undefined : mode.onExpandContext;
  const compressedTree = useMemo(() => compressSingleChildChains(buildDiffTree(files)), [files]);
  const allFolderPaths = useMemo(() => collectDirPaths(compressedTree), [compressedTree]);
  const allFolderPathSet = useMemo(() => new Set(allFolderPaths), [allFolderPaths]);
  const effectiveCollapsedFolders = useMemo(
    () => new Set(Array.from(collapsedFolders).filter((path) => allFolderPathSet.has(path))),
    [allFolderPathSet, collapsedFolders],
  );
  const diffListRef = useRef<FlatList<DiffFlatItem>>(null);
  const scrollbar = useOverlayFlatListScrollbar(diffListRef, { enabled: !isCompact });
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
  const [lastAutoApprovedLine, setLastAutoApprovedLine] = useState<ReviewableChangedLine | null>(
    null,
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
        return `${layout}:${wrapLines ? "wrap" : "scroll"}:${typographyKey}:${file.path}:${file.status}`;
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
      const height = event.nativeEvent.layout.height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      diffListViewportHeightRef.current = height;
      updateScrollbarLayout(event);
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
      scrollElement.focus();
    }
  }, []);

  useEffect(() => {
    if (!selectedLineId) return;
    if (!orderedReviewLines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(null);
      setLastAutoApprovedLine(null);
    }
  }, [orderedReviewLines, selectedLineId]);

  useEffect(() => {
    if (!isWeb || !selectedLine) return;
    setReviewFileExpanded(selectedLine.target.filePath, true);
    let frame: number | null = null;
    let remainingAttempts = 12;
    let revealedFileHeader = false;
    const revealSelectedLine = () => {
      const escape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/["\\]/g, "\\$&"));
      const element = document.querySelector<HTMLElement>(
        `[data-paseito-review-target-key="${escape(selectedLine.target.key)}"][data-paseito-review-selected="true"]`,
      );
      if (element) {
        let viewport = element.parentElement;
        while (viewport) {
          const style = getComputedStyle(viewport);
          if (
            viewport.scrollHeight > viewport.clientHeight &&
            (style.overflowY === "auto" || style.overflowY === "scroll")
          ) {
            break;
          }
          viewport = viewport.parentElement;
        }
        if (!viewport) {
          element.scrollIntoView({ block: "center", inline: "nearest" });
          return;
        }
        const viewportBounds = viewport.getBoundingClientRect();
        const targetBounds = element.getBoundingClientRect();
        if (!isReviewTargetFullyVisible({ viewport: viewportBounds, target: targetBounds })) {
          element.scrollIntoView({ block: "center", inline: "nearest" });
        }
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
  }, [computeHeaderOffset, selectedLine, setReviewFileExpanded]);

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
      else handleMoveReviewSelection(action === "move-down" ? "down" : "up");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    fileReviews,
    handleEditSelectedLine,
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
        `[data-paseito-diff-file="${escape(focusPath)}"][data-paseito-diff-current-line="${focusLineStart}"]`,
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

      mode.onExpandedPathsChange(
        nextExpanded
          ? [...expandedPaths, path]
          : Array.from(expandedPaths).filter((expandedPath) => expandedPath !== path),
      );
    },
    [computeHeaderOffset, expandedPaths, mode],
  );

  const handleToggleReviewed = useCallback(
    (path: string) => {
      if (mode.kind === "commit" || !fileReviews) return;
      const isNowReviewed = fileReviews.toggle(path);
      mode.onExpandedPathsChange(
        isNowReviewed
          ? collapseReviewedFile(expandedPaths, path)
          : expandUnreviewedFile(expandedPaths, path),
      );
    },
    [expandedPaths, fileReviews, mode],
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
          diffListRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
        }
      }

      mode.onCollapsedFoldersChange(
        isCurrentlyCollapsed
          ? Array.from(effectiveCollapsedFolders).filter((path) => path !== dirPath)
          : [...effectiveCollapsedFolders, dirPath],
      );
    },
    [computeItemOffset, effectiveCollapsedFolders, mode],
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
            additions={item.additions}
            deletions={item.deletions}
            onToggle={handleToggleFolder}
            onHeightChange={handleFolderRowHeightChange}
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
            depth={item.depth}
            showDir={viewMode === "flat"}
            interactive={interactive}
            onToggle={interactive ? (onFilePress ?? handleToggleExpanded) : undefined}
            onOpenFile={onOpenFile}
            onAddToChat={onAddToChat}
            onCopyPath={onCopyPath}
            onDownload={onDownload}
            onHeaderHeightChange={handleHeaderHeightChange}
            fileReviews={fileReviews}
            onToggleReviewed={fileReviews ? handleToggleReviewed : undefined}
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
          onExpandContext={onExpandContext}
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
      handleToggleExpanded,
      handleToggleFolder,
      handleToggleReviewed,
      layout,
      reviewActions,
      lineReviewPresentation,
      navigationHighlight,
      fileReviews,
      workspaceFileDragScope,
      textMetricsStyle,
      viewMode,
      wrapLines,
      interactive,
      onFilePress,
      onOpenFile,
      onAddToChat,
      onCopyPath,
      onDownload,
      onExpandContext,
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
      typographyKey,
      viewMode,
      workspaceFileDragScope,
      wrapLines,
    ],
  );

  return (
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
        showsVerticalScrollIndicator={!scrollbar.enabled}
        removeClippedSubviews={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={10}
      />
      {scrollbar.overlay}
      {selectedLine ? (
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
    return input.t("workspace.git.forgeSetup.installCli", { cli: signInCli, brand: brandLabel });
  }
  const command = buildForgeSignInCommand(input.forge, input.host);
  return input.t("workspace.git.forgeSetup.signIn", { command, brand: brandLabel });
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
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? cwd }),
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
  const canUseSplitLayout = isWeb && !isMobile;
  const { preferences: changesPreferences, updatePreferences: updateChangesPreferences } =
    useChangesPreferences();
  const wrapLines = changesPreferences.wrapLines;
  const viewMode = changesPreferences.viewMode;
  const effectiveLayout = resolveDiffLayout(changesPreferences.layout, canUseSplitLayout);

  const handleToggleWrapLines = useCallback(() => {
    void updateChangesPreferences({ wrapLines: !wrapLines });
  }, [updateChangesPreferences, wrapLines]);

  const handleToggleHideWhitespace = useCallback(() => {
    void updateChangesPreferences({ hideWhitespace: !changesPreferences.hideWhitespace });
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
  const {
    changesTabOpen,
    toggleChanges: handleToggleChangesTab,
    openCommit: handleCommitPress,
    onChangesFilePress,
  } = useDiffTabNavigation({ serverId, workspaceId, cwd, isMobile });
  const refreshSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
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
    diffMode,
    selectUncommitted: handleSelectUncommitted,
    selectBase: handleSelectBase,
    files,
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
    (filePath: string, region: DiffContextRegion, direction: "up" | "down" | "all") => {
      void contextExpansion.expand(filePath, region, direction).catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.diff.context.failedToExpand"),
        );
      });
    },
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
  const downloadFile = useFileDownload({ serverId, workspaceId, workspaceRoot: cwd });
  const handleCopyPath = useCallback(
    (path: string) => {
      void Clipboard.setStringAsync(
        buildAbsoluteExplorerPath({ workspaceRoot: cwd, entryPath: path }),
      );
    },
    [cwd],
  );
  const handleDownloadPath = useCallback(
    (path: string) => {
      downloadFile({ fileName: path.split("/").pop() ?? path, path });
    },
    [downloadFile],
  );
  const handleEditLine = useCallback(
    (line: ReviewableChangedLine) => {
      const lineStart = line.target.editLineNumber;
      if (!lineStart) return;
      onOpenFile?.(line.target.filePath, { lineStart, openMode: "source" });
    },
    [onOpenFile],
  );
  const workingTreeMode = useMemo(
    () => ({
      kind: "working_tree" as const,
      viewMode,
      expandedPaths: changesTree.expandedPaths,
      collapsedFolders: changesTree.collapsedFolders,
      reviewActions,
      fileReviews,
      keyboardEnabled: enabled !== false && !changesTabOpen,
      onEditLine: onOpenFile && fileEditingSupported ? handleEditLine : undefined,
      onFilePress: onChangesFilePress,
      workspaceFileDragScope: workspaceId ? { serverId, workspaceId } : undefined,
      onOpenFile,
      onAddToChat,
      onCopyPath: handleCopyPath,
      onDownload: handleDownloadPath,
      onExpandContext: contextExpansionSupported ? handleExpandContext : undefined,
      onExpandedPathsChange: changesTree.updateExpandedPaths,
      onCollapsedFoldersChange: changesTree.updateCollapsedFolders,
    }),
    [
      enabled,
      changesTabOpen,
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
      handleDownloadPath,
      contextExpansionSupported,
      handleExpandContext,
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
    <View style={styles.container}>
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
                onRefresh={handleRefresh}
                onToggleHideWhitespace={handleToggleHideWhitespace}
                onToggleWrapLines={handleToggleWrapLines}
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
  },
  fileDir: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flex: 1,
    minWidth: 0,
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
