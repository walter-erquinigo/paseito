import { useState, useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TreeRail } from "@/components/tree-rail";
import { TreeRailToggle } from "@/components/tree-rail-toggle";
import { DiffStat } from "@/components/diff-stat";
import {
  View,
  Text,
  Pressable,
  FlatList,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  AlignJustify,
  ChevronDown,
  Columns2,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Pilcrow,
  RotateCw,
  WrapText,
} from "lucide-react-native";
import { type ParsedDiffFile } from "@/git/use-diff-query";
import type { ChangesState } from "@/panels/changes/state";
import { defaultChangesState } from "@/panels/changes/state";
import { DiffDocument, type WorkingDiffMode } from "@/git/diff-document";
import { FileHeader } from "@/git/file-header";
import {
  buildDiffTree,
  collectDirPaths,
  compressSingleChildChains,
  flattenDiffTree,
  type DiffTreeRow,
} from "@/git/diff-tree";
import { DiffFolderRow } from "@/git/diff-folder-row";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { CommitsSection } from "@/git/commits-section/commits-section";
import { useAppSettings } from "@/hooks/use-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as Clipboard from "expo-clipboard";
import { useFileDownload } from "@/hooks/use-file-download";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import type { GitActions } from "@/git/policy";
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
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  PaneContentToolbar,
  paneContentToolbarIconSize,
  paneContentToolbarIconButtonStyle,
} from "@/components/ui/pane-content-toolbar";
import { FOCUSED_PANE_PLACEMENT, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceTabPlacement } from "@/stores/workspace-layout-actions";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { isWeb } from "@/constants/platform";
import { usePublishWorkingDiffAttachment, useWorkingDiff } from "@/git/use-working-diff";
import { useChangesLsp } from "@/git/use-changes-lsp";
import type { ChangesSearchMatch } from "@/git/changes-search";
import type { FileReviewActions, ReviewableChangedLine } from "@/review";
import type { WorkspaceFileOpenOptions } from "@/workspace/file-open";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { DiffTooLargeState } from "@/git/diff-too-large-state";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { ChangesBaseSelector } from "@/git/changes-base-selector";
import {
  applyChangesBaseSelection,
  getChangesStackParentBadgeKind,
} from "@/git/changes-base-selection";
import { retainSelectedChangesFile } from "@/git/changes-file-tree-navigation";
import { collapseReviewedFiles, revealFileAncestorFolders } from "@/git/file-review-expansion";
import {
  CHANGES_FILE_TREE_MIN_PANE_WIDTH,
  ChangesFileTreeNavigator,
  ChangesFileTreeToggle,
} from "@/git/changes-file-tree-navigator";
import {
  clearInlineWorkingDiffNavigationSnapshot,
  clearWorkingDiffNavigationSnapshot,
  publishInlineWorkingDiffNavigationSnapshot,
  publishWorkingDiffNavigationSnapshot,
} from "@/workspace/markdown-changes-navigation";
import { useChangesDiscussions } from "@/git/use-changes-discussions";
import {
  buildChangesDiscussionThreads,
  groupChangesDiscussionsByTarget,
  isOpenChangesDiscussion,
  type ChangesDiscussionThread,
} from "@/git/changes-discussions";
import { ChangesDiscussionInbox } from "@/git/changes-discussion-inbox";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

export function resolveDiffLayout(
  layout: "unified" | "split",
  canUseSplitLayout: boolean,
): "unified" | "split" {
  return canUseSplitLayout ? layout : "unified";
}

interface ChangesFocusRequest {
  path: string;
  revision: number;
  lineStart?: number;
  lineEnd?: number;
  column?: number;
  reveal?: "center-if-hidden";
}

function createExternalFocusRequest(input: {
  path?: string;
  revision?: number;
  lineStart?: number;
  lineEnd?: number;
  column?: number;
  reveal?: "center-if-hidden";
}): ChangesFocusRequest | null {
  if (!input.path) return null;
  return { ...input, path: input.path, revision: input.revision ?? 0 };
}

function selectNewestFocusRequest(
  local: ChangesFocusRequest | null,
  external: ChangesFocusRequest | null,
): ChangesFocusRequest | null {
  if (!local) return external;
  if (!external) return local;
  return local.revision >= external.revision ? local : external;
}

function nextFocusRevision(current: ChangesFocusRequest | null): number {
  return Math.max(Date.now(), (current?.revision ?? 0) + 1);
}

function focusModeProperties(focus: ChangesFocusRequest | null): Partial<WorkingDiffMode> {
  if (!focus) return {};
  return {
    focusPath: focus.path,
    focusRequestId: focus.revision,
    focusLineStart: focus.lineStart,
    focusLineEnd: focus.lineEnd,
    focusColumn: focus.column,
    focusReveal: focus.reveal,
  };
}

function workspaceFileDragScope(serverId: string, workspaceId?: string) {
  return workspaceId ? { serverId, workspaceId } : undefined;
}

function desktopTargetLabel(target: { label: string } | undefined): string | undefined {
  return target?.label;
}

function buildWorkingDiffMode(input: {
  base: Omit<
    WorkingDiffMode,
    | "kind"
    | "onExpandContext"
    | "focusPath"
    | "focusRequestId"
    | "focusLineStart"
    | "focusLineEnd"
    | "focusColumn"
    | "focusReveal"
    | "workspaceFileDragScope"
    | "onReveal"
    | "onDuplicate"
  > & {
    onReveal: WorkingDiffMode["onReveal"];
    onDuplicate: WorkingDiffMode["onDuplicate"];
  };
  contextExpansionSupported: boolean;
  expandContext: WorkingDiffMode["onExpandContext"];
  focus: ChangesFocusRequest | null;
  serverId: string;
  workspaceId?: string;
  revealAvailable: boolean;
  duplicateAvailable: boolean;
}): WorkingDiffMode {
  return {
    ...input.base,
    kind: "working",
    onExpandContext: input.contextExpansionSupported ? input.expandContext : undefined,
    ...focusModeProperties(input.focus),
    workspaceFileDragScope: workspaceFileDragScope(input.serverId, input.workspaceId),
    onReveal: input.revealAvailable ? input.base.onReveal : undefined,
    onDuplicate: input.duplicateAvailable ? input.base.onDuplicate : undefined,
  };
}

function resolveChangesState(state: ChangesState | undefined): ChangesState {
  return state ?? defaultChangesState;
}

function resolveStateChange(
  onStateChange: ((state: ChangesState) => void) | undefined,
): (state: ChangesState) => void {
  return onStateChange ?? noopStateChange;
}

function resolveNavigatorVisibility(input: {
  canUseSplitLayout: boolean;
  paneWidth: number;
  hasChanges: boolean;
  collapsed: boolean;
}): { available: boolean; shown: boolean } {
  const available =
    input.canUseSplitLayout &&
    input.paneWidth >= CHANGES_FILE_TREE_MIN_PANE_WIDTH &&
    input.hasChanges;
  return { available, shown: available && !input.collapsed };
}

function computeSelectedDiffStat(
  files: ParsedDiffFile[],
  isLoading: boolean,
): { additions: number; deletions: number } | null {
  if (isLoading) {
    return null;
  }
  return files.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

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
        message: t("workspace.fileActions.confirmRevert.message", { name: path }),
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

interface ChangesSurfaceProps {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  enabled?: boolean;
  host: "explorer" | "panel";
  modeScope: string;
  focusPath?: string;
  focusRequestId?: number;
  focusLineStart?: number;
  focusLineEnd?: number;
  focusColumn?: number;
  focusReveal?: "center-if-hidden";
  onActivate?: () => void;
  onOpenFile?: (path: string, options?: WorkspaceFileOpenOptions) => void;
  onAddToChat?: (path: string) => void;
  state?: ChangesState;
  onStateChange?: (state: ChangesState) => void;
}

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean; open?: boolean },
) => StyleProp<ViewStyle>;

const foregroundMutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedAlignJustify = withUnistyles(AlignJustify);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const ThemedMaximize2 = withUnistyles(Maximize2);
const noopStateChange = () => {};
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const discussionButtonIcon = (
  <ThemedMessageSquare size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_WHITESPACE_ICON = (
  <ThemedPilcrow size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_WRAP_ICON = (
  <ThemedWrapText size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_SPLIT_ICON = (
  <ThemedColumns2 size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_COLLAPSE_ICON = (
  <ThemedListChevronsDownUp size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_EXPAND_ICON = (
  <ThemedListChevronsUpDown size={14} uniProps={foregroundMutedIconColorMapping} />
);
const DIFF_OPTIONS_CHANGES_TAB_ICON = (
  <ThemedMaximize2 size={14} uniProps={foregroundMutedIconColorMapping} />
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
    () => buildToggleButtonStyle(false, undefined, isMobile),
    [isMobile],
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

function resolveChangesTabOpen(host: "explorer" | "panel", changesTabOpen: boolean): boolean {
  return host === "explorer" ? changesTabOpen : false;
}

function resolveChangesFilePress(
  host: "explorer" | "panel",
  onChangesFilePress: ((path?: string) => void) | undefined,
): ((path?: string) => void) | undefined {
  return host === "explorer" ? onChangesFilePress : undefined;
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

interface ChangesToolbarProps {
  branchName: string | null;
  baseSelection: ReturnType<typeof useWorkingDiff>["baseSelection"];
  allFilesCollapsed: boolean;
  canUseSplitLayout: boolean;
  changesTabOpen: boolean;
  committedDescription?: string;
  cwd: string;
  desktopTreeVisible: boolean;
  fileNavigatorAvailable: boolean;
  fileNavigatorCollapsed: boolean;
  fileReviews: FileReviewActions;
  diffMode: "uncommitted" | "base";
  gitActions: GitActions;
  hasFiles: boolean;
  hideWhitespace: boolean;
  host: "explorer" | "panel";
  isMobile: boolean;
  isRefreshing: boolean;
  layout: "unified" | "split";
  overflowToggleStyle: PressableStyleFn;
  refreshSupported: boolean;
  selectedDiffStat: { additions: number; deletions: number } | null;
  hasUncommittedChanges: boolean;
  serverId: string;
  workspaceId?: string | null;
  wrapLines: boolean;
  discussionCount: number;
  showDiscussionControl: boolean;
  onOpenDiscussions: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onMarkAllReviewed: () => void;
  onMarkAllUnreviewed: () => void;
  onOrganizeByReview: () => void;
  onSelectBase: () => void;
  onSelectComparisonBase: (baseRef: string | null) => Promise<void>;
  onSelectUncommitted: () => void;
  onToggleChangesTab: () => void;
  onToggleDesktopTree: () => void;
  onToggleFileNavigator: () => void;
  onToggleHideWhitespace: () => void;
  onToggleLayout: () => void;
  onToggleWrapLines: () => void;
}

// One row: the diff-mode and branch pickers lead, the git actions and the
// overflow menu trail. The tree toggle is the only icon action that stays out
// of the menu, and it only exists on desktop, so a phone-width row holds two
// pickers, the split button, and the trigger without wrapping.
function ChangesToolbar(props: ChangesToolbarProps) {
  const {
    branchName,
    baseSelection,
    committedDescription,
    cwd,
    desktopTreeVisible,
    fileNavigatorAvailable,
    fileNavigatorCollapsed,
    fileReviews,
    diffMode,
    gitActions,
    hasFiles,
    isMobile,
    selectedDiffStat,
    hasUncommittedChanges,
    serverId,
    workspaceId,
    onSelectBase,
    onSelectComparisonBase,
    onSelectUncommitted,
    onToggleDesktopTree,
    onToggleFileNavigator,
    onMarkAllReviewed,
    onMarkAllUnreviewed,
    onOrganizeByReview,
    discussionCount,
    showDiscussionControl,
    onOpenDiscussions,
  } = props;
  return (
    <PaneContentToolbar style={styles.changesToolbar} testID="changes-header">
      <View style={styles.changesToolbarIdentity}>
        <DiffModeMenu
          diffMode={diffMode}
          committedDescription={committedDescription}
          onSelectUncommitted={onSelectUncommitted}
          onSelectBase={onSelectBase}
        />
        <BranchSwitcher
          currentBranchName={branchName}
          serverId={serverId}
          workspaceId={workspaceId ?? cwd}
          workspaceDirectory={cwd}
          isGitCheckout
          testID="changes-branch-switcher"
        />
        <ChangesUncommittedActions
          serverId={serverId}
          cwd={cwd}
          currentBranchName={branchName}
          hasUncommittedChanges={hasUncommittedChanges}
        />
        <ChangesBaseSelectorPlacement
          visible={!isMobile}
          serverId={serverId}
          cwd={cwd}
          currentBranchName={branchName}
          baseSelection={baseSelection}
          onSelect={onSelectComparisonBase}
        />
        {!isMobile && selectedDiffStat ? (
          <DiffStat
            additions={selectedDiffStat.additions}
            deletions={selectedDiffStat.deletions}
            testID="changes-selected-diff-stat"
          />
        ) : null}
      </View>
      <View style={styles.changesToolbarControls}>
        {showDiscussionControl ? (
          <Button
            variant="ghost"
            size="xs"
            leftIcon={discussionButtonIcon}
            onPress={onOpenDiscussions}
            testID="changes-discussions-button"
            accessibilityLabel={`MR comments, ${discussionCount} open`}
          >
            {isMobile ? String(discussionCount) : `Comments ${discussionCount}`}
          </Button>
        ) : null}
        {!isMobile && hasFiles ? (
          <TreeRailToggle
            visible={desktopTreeVisible}
            testID="changes-toggle-tree"
            onToggle={onToggleDesktopTree}
          />
        ) : null}
        {!isMobile && fileNavigatorAvailable ? (
          <ChangesFileTreeToggle
            collapsed={fileNavigatorCollapsed}
            onToggle={onToggleFileNavigator}
          />
        ) : null}
        {isMobile ? <GitActionsSplitButton gitActions={gitActions} menuOnly /> : null}
        {hasFiles ? (
          <ReviewBulkMenu
            fileReviews={fileReviews}
            onMarkAllReviewed={onMarkAllReviewed}
            onMarkAllUnreviewed={onMarkAllUnreviewed}
            onOrganizeByReview={onOrganizeByReview}
          />
        ) : null}
        <ChangesOptionsMenu {...props} />
      </View>
    </PaneContentToolbar>
  );
}

function ReviewBulkMenu({
  fileReviews,
  onMarkAllReviewed,
  onMarkAllUnreviewed,
  onOrganizeByReview,
}: {
  fileReviews: FileReviewActions;
  onMarkAllReviewed: () => void;
  onMarkAllUnreviewed: () => void;
  onOrganizeByReview: () => void;
}) {
  const { t } = useTranslation();
  const triggerStyle = useMemo(() => buildDiffModeTriggerStyle(), []);
  const hasLineProgress = fileReviews.reviewableLineCount > 0;
  const reviewed = hasLineProgress ? fileReviews.reviewedLineCount : fileReviews.reviewedCount;
  const total = hasLineProgress ? fileReviews.reviewableLineCount : fileReviews.reviewableCount;
  const disabled = !fileReviews.available || fileReviews.reviewableCount === 0;
  const allReviewed =
    fileReviews.reviewableCount > 0 && fileReviews.reviewedCount === fileReviews.reviewableCount;
  const hasReviewedChanges = fileReviews.reviewedCount > 0 || fileReviews.reviewedLineCount > 0;
  const triggerLabel = t("workspace.git.diff.reviewMenu", { reviewed, total });
  let accessibilityLabel = t("workspace.git.diff.reviewProgress", {
    reviewedLines: fileReviews.reviewedLineCount,
    totalLines: fileReviews.reviewableLineCount,
    reviewedFiles: fileReviews.reviewedCount,
    totalFiles: fileReviews.reviewableCount,
  });
  if (!fileReviews.supported) {
    accessibilityLabel = t("workspace.git.diff.reviewUpdateHost");
  } else if (!fileReviews.available) {
    accessibilityLabel = t("workspace.git.diff.reviewBranchRequired");
  }
  return (
    <DropdownMenu>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <View>
            <DropdownMenuTrigger
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              disabled={disabled}
              testID="changes-review-menu"
              style={triggerStyle}
            >
              <Text style={styles.diffStatusText} numberOfLines={1}>
                {triggerLabel}
              </Text>
              <ThemedChevronDown size={12} uniProps={foregroundMutedIconColorMapping} />
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{accessibilityLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" width={280} testID="changes-review-menu-content">
        <DropdownMenuItem
          disabled={allReviewed}
          testID="changes-review-mark-all"
          onSelect={onMarkAllReviewed}
        >
          {t("workspace.git.diff.markAllChangesReviewed")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasReviewedChanges}
          testID="changes-review-clear-all"
          onSelect={onMarkAllUnreviewed}
        >
          {t("workspace.git.diff.markAllChangesUnreviewed")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem testID="changes-review-organize" onSelect={onOrganizeByReview}>
          {t("workspace.git.diff.organizeByReview")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const { t } = useTranslation();
  if (!visible || !currentBranchName) return null;
  const badgeKind = getChangesStackParentBadgeKind(baseSelection.stackParentStatus);
  return (
    <>
      <ChangesBaseSelector
        serverId={serverId}
        cwd={cwd}
        currentBranch={currentBranchName}
        defaultBaseRef={baseSelection.defaultBaseRef}
        recordedBaseRef={baseSelection.recordedBaseRef}
        selectedBaseRef={baseSelection.selectedBaseRef}
        effectiveBaseRef={baseSelection.effectiveBaseRef}
        supported={baseSelection.supported}
        onSelect={onSelect}
      />
      {badgeKind ? (
        <StatusBadge
          label={t(
            badgeKind === "malformed"
              ? "workspace.git.diff.stackParentMalformed"
              : "workspace.git.diff.stackParentMissing",
          )}
          variant="error"
          testID={`changes-stack-parent-${badgeKind}-badge`}
        />
      ) : null}
    </>
  );
}

function ChangesUncommittedActions({
  serverId,
  cwd,
  currentBranchName,
  hasUncommittedChanges,
}: {
  serverId: string;
  cwd: string;
  currentBranchName: string | null;
  hasUncommittedChanges: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  // COMPAT(checkoutCommitAmend): added in Paseito v0.2.5-paseito.1, remove after 2027-02-04.
  const amendSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutCommitAmend === true,
  );
  const amend = useCheckoutGitActionsStore((state) => state.amend);
  const isAmending =
    useCheckoutGitActionsStore((state) => state.getStatus({ serverId, cwd, actionId: "amend" })) ===
    "pending";
  const handleAmend = useCallback(() => {
    if (!amendSupported) {
      toast.error(t("workspace.git.diff.amendUpdateHost"));
      return;
    }
    if (isAmending) return;
    void amend({ serverId, cwd })
      .then(() => toast.show(t("workspace.git.diff.amendSuccess"), { variant: "success" }))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedAmend")),
      );
  }, [amend, amendSupported, cwd, isAmending, serverId, t, toast]);
  if (!currentBranchName || !hasUncommittedChanges) return null;
  return (
    <>
      <StatusBadge
        label={t("workspace.git.diff.uncommitted")}
        variant="muted"
        testID="changes-uncommitted-badge"
      />
      <Button
        variant="outline"
        size="xs"
        loading={isAmending}
        onPress={handleAmend}
        testID="changes-amend-button"
        accessibilityLabel={t("workspace.git.diff.amend")}
      >
        {isAmending ? t("workspace.git.diff.amending") : t("workspace.git.diff.amend")}
      </Button>
    </>
  );
}

type ChangesOptionsMenuProps = Pick<
  ChangesToolbarProps,
  | "allFilesCollapsed"
  | "canUseSplitLayout"
  | "changesTabOpen"
  | "hasFiles"
  | "hideWhitespace"
  | "host"
  | "isMobile"
  | "isRefreshing"
  | "layout"
  | "overflowToggleStyle"
  | "refreshSupported"
  | "wrapLines"
  | "onCollapseAll"
  | "onExpandAll"
  | "onRefresh"
  | "onToggleChangesTab"
  | "onToggleHideWhitespace"
  | "onToggleLayout"
  | "onToggleWrapLines"
>;

function ChangesOptionsMenu({
  allFilesCollapsed,
  canUseSplitLayout,
  changesTabOpen,
  hasFiles,
  hideWhitespace,
  host,
  isMobile,
  isRefreshing,
  layout,
  overflowToggleStyle,
  refreshSupported,
  wrapLines,
  onCollapseAll,
  onExpandAll,
  onRefresh,
  onToggleChangesTab,
  onToggleHideWhitespace,
  onToggleLayout,
  onToggleWrapLines,
}: ChangesOptionsMenuProps) {
  const { t } = useTranslation();
  const optionsLabel = t("workspace.git.diff.options");
  const collapseLabel = t(
    allFilesCollapsed ? "workspace.git.diff.expandAllFiles" : "workspace.git.diff.collapseAllFiles",
  );
  const changesTabLabel = t(
    changesTabOpen ? "workspace.git.diff.closeChangesTab" : "workspace.git.diff.openChangesTab",
  );
  const whitespaceLabel = hideWhitespace
    ? t("workspace.git.diff.showWhitespace")
    : t("workspace.git.diff.hideWhitespace");
  const wrapLinesLabel = wrapLines
    ? t("workspace.git.diff.scrollLongLines")
    : t("workspace.git.diff.wrapLongLines");
  const refreshLabel = isRefreshing
    ? t("workspace.git.diff.refreshing")
    : t("workspace.git.diff.refresh");
  const refreshIcon = useMemo(
    () =>
      isRefreshing ? (
        <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedIconColorMapping} />
      ) : (
        <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundMutedIconColorMapping} />
      ),
    [isRefreshing],
  );

  const showChangesTab = host === "explorer" && !isMobile;
  const showLayout = canUseSplitLayout && !changesTabOpen;

  return (
    <DropdownMenu>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={optionsLabel}
            testID="changes-options-menu"
            style={overflowToggleStyle}
          >
            <ThemedMoreHorizontal
              size={paneContentToolbarIconSize(isMobile)}
              uniProps={foregroundMutedIconColorMapping}
            />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{optionsLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" width={240} testID="changes-options-menu-content">
        {hasFiles ? (
          <DropdownMenuItem
            leading={allFilesCollapsed ? DIFF_OPTIONS_EXPAND_ICON : DIFF_OPTIONS_COLLAPSE_ICON}
            testID="changes-toggle-collapse-all"
            onSelect={allFilesCollapsed ? onExpandAll : onCollapseAll}
          >
            {collapseLabel}
          </DropdownMenuItem>
        ) : null}
        {showChangesTab ? (
          <DropdownMenuItem
            leading={DIFF_OPTIONS_CHANGES_TAB_ICON}
            testID="changes-open-tab"
            onSelect={onToggleChangesTab}
          >
            {changesTabLabel}
          </DropdownMenuItem>
        ) : null}
        {hasFiles || showChangesTab ? <DropdownMenuSeparator /> : null}
        {showLayout ? (
          <DropdownMenuItem
            leading={DIFF_OPTIONS_SPLIT_ICON}
            selected={layout === "split"}
            testID="changes-toggle-layout"
            onSelect={onToggleLayout}
          >
            {t("workspace.git.diff.split")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          leading={DIFF_OPTIONS_WHITESPACE_ICON}
          selected={hideWhitespace}
          testID="changes-toggle-whitespace"
          onSelect={onToggleHideWhitespace}
        >
          {whitespaceLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={DIFF_OPTIONS_WRAP_ICON}
          selected={wrapLines}
          testID="changes-toggle-wrap-lines"
          onSelect={onToggleWrapLines}
        >
          {wrapLinesLabel}
        </DropdownMenuItem>
        {refreshSupported ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              leading={refreshIcon}
              disabled={isRefreshing}
              testID="changes-refresh"
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
  emptyAction: ChangesEmptyAction | null;
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
  emptyAction,
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
        {emptyAction ? (
          <Button
            variant="ghost"
            size="xs"
            testID="changes-empty-switch-mode"
            onPress={emptyAction.onPress}
          >
            {emptyAction.label}
          </Button>
        ) : null}
      </View>
    );
  }
  return children;
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

interface ChangesEmptyAction {
  label: string;
  onPress: () => void;
}

function computeChangesEmptyAction(input: {
  hideWhitespace: boolean;
  diffMode: "uncommitted" | "base";
  status: CheckoutStatusPayload | null;
  seeUncommittedLabel: string;
  seeCommittedLabel: string;
  selectUncommitted: () => void;
  selectBase: () => void;
}): ChangesEmptyAction | null {
  if (input.hideWhitespace || !input.status?.isGit) {
    return null;
  }
  if (input.diffMode === "base" && input.status.isDirty) {
    return { label: input.seeUncommittedLabel, onPress: input.selectUncommitted };
  }
  if (input.diffMode === "uncommitted" && (input.status.aheadBehind?.ahead ?? 0) > 0) {
    return { label: input.seeCommittedLabel, onPress: input.selectBase };
  }
  return null;
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

function buildOverflowButtonStyle(isMobile: boolean): PressableStyleFn {
  return (state) => paneContentToolbarIconButtonStyle(state, false, isMobile);
}

function buildToggleButtonStyle(
  selected: boolean,
  baseStyles?: StyleProp<ViewStyle> | StyleProp<ViewStyle>[],
  isMobile = false,
): PressableStyleFn {
  return (state) => [baseStyles, paneContentToolbarIconButtonStyle(state, selected, isMobile)];
}

function ChangedFilesTree({
  files,
  mode,
  onSelectFile,
  collapsedFolderPaths,
  onCollapsedFolderPathsChange,
}: {
  files: ParsedDiffFile[];
  mode: WorkingDiffMode;
  onSelectFile: (path: string) => void;
  collapsedFolderPaths: string[];
  onCollapsedFolderPathsChange: (paths: string[]) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const compressedTree = useMemo(() => compressSingleChildChains(buildDiffTree(files)), [files]);
  const allFolderPaths = useMemo(() => collectDirPaths(compressedTree), [compressedTree]);
  const collapsedFolders = useMemo(() => new Set(collapsedFolderPaths), [collapsedFolderPaths]);
  const items = useMemo(
    () => flattenDiffTree(compressedTree, collapsedFolders),
    [collapsedFolders, compressedTree],
  );
  const handleSelectPath = useCallback((path: string) => setSelectedPath(path), []);
  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedPath(path);
      onSelectFile(path);
    },
    [onSelectFile],
  );
  const handleToggleFolder = useCallback(
    (dirPath: string) => {
      const next = collapsedFolders.has(dirPath)
        ? Array.from(collapsedFolders).filter((path) => path !== dirPath)
        : [...collapsedFolders, dirPath];
      onCollapsedFolderPathsChange(next);
    },
    [collapsedFolders, onCollapsedFolderPathsChange],
  );
  const handleCollapseFolder = useCallback(
    (dirPath: string) => {
      const prefix = `${dirPath}/`;
      onCollapsedFolderPathsChange([
        ...new Set([
          ...collapsedFolders,
          ...allFolderPaths.filter(
            (folderPath) => folderPath === dirPath || folderPath.startsWith(prefix),
          ),
        ]),
      ]);
    },
    [allFolderPaths, collapsedFolders, onCollapsedFolderPathsChange],
  );
  const renderItem = useCallback(
    ({ item }: { item: DiffTreeRow }) => {
      if (item.kind === "folder") {
        return (
          <DiffFolderRow
            dirPath={item.dirPath}
            displayName={item.displayName}
            depth={item.depth}
            collapsed={collapsedFolders.has(item.dirPath)}
            isSelected={selectedPath === item.dirPath}
            additions={item.additions}
            deletions={item.deletions}
            onToggle={handleToggleFolder}
            onCollapse={handleCollapseFolder}
            onSelect={handleSelectPath}
            onCopyPath={mode.onCopyPath}
            onCopyRelativePath={mode.onCopyRelativePath}
            onReveal={mode.onReveal}
            revealTargetName={mode.revealTargetName}
            onDuplicate={mode.onDuplicate}
            onRevert={mode.onRevert}
            testID={`diff-folder-${item.dirPath}`}
          />
        );
      }
      return (
        <FileHeader
          file={item.file}
          workspaceFileDragScope={mode.workspaceFileDragScope}
          bodyVisible={false}
          showsBodyState={false}
          isSelected={selectedPath === item.file.path}
          depth={item.depth}
          showDir={false}
          onActivate={handleSelectFile}
          onSelect={handleSelectPath}
          onOpenFile={mode.onOpenFile}
          onAddToChat={mode.onAddToChat}
          onCopyPath={mode.onCopyPath}
          onCopyRelativePath={mode.onCopyRelativePath}
          onReveal={mode.onReveal}
          revealTargetName={mode.revealTargetName}
          onDownload={mode.onDownload}
          onDuplicate={mode.onDuplicate}
          onRevert={mode.onRevert}
          testID={`diff-tree-file-${item.fileIndex}`}
        />
      );
    },
    [
      handleCollapseFolder,
      handleSelectFile,
      handleSelectPath,
      handleToggleFolder,
      collapsedFolders,
      mode,
      selectedPath,
    ],
  );
  const keyExtractor = useCallback(
    (item: DiffTreeRow) =>
      item.kind === "folder" ? `folder-${item.dirPath}` : `file-${item.file.path}`,
    [],
  );

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      testID="changes-file-tree"
    />
  );
}

function ChangesTreeRail({
  shown,
  children,
  files,
  mode,
  onSelectFile,
  treeWidth,
  onTreeWidthChange,
  collapsedFolderPaths,
  onCollapsedFolderPathsChange,
}: {
  shown: boolean;
  children: ReactElement;
  files: ParsedDiffFile[];
  mode: WorkingDiffMode;
  onSelectFile: (path: string) => void;
  treeWidth?: number;
  onTreeWidthChange: (width: number) => void;
  collapsedFolderPaths: string[];
  onCollapsedFolderPathsChange: (paths: string[]) => void;
}) {
  if (!shown) return children;
  return (
    <TreeRail testID="changes-tree-rail" width={treeWidth ?? 220} onWidthChange={onTreeWidthChange}>
      {children}
      <ChangedFilesTree
        files={files}
        mode={mode}
        onSelectFile={onSelectFile}
        collapsedFolderPaths={collapsedFolderPaths}
        onCollapsedFolderPathsChange={onCollapsedFolderPathsChange}
      />
    </TreeRail>
  );
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
  const openTab = useWorkspaceLayoutStore((state) => state.openTab);
  const openWorkspaceTabInFocusedPane = useCallback(
    (workspaceKey: string, target: WorkspaceTabTarget, placement?: WorkspaceTabPlacement) =>
      openTab({ workspaceKey, target, intent: "reveal", placement }),
    [openTab],
  );
  const persistenceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? cwd }),
    [cwd, serverId, workspaceId],
  );
  const changesTabOpen = useWorkspaceLayoutStore((state) =>
    persistenceKey
      ? state.getWorkspaceTabs(persistenceKey).some((tab) => tab.target.kind === "working_diff")
      : false,
  );
  const openChanges = useCallback(
    (path?: string) => {
      if (!persistenceKey || isMobile) {
        return;
      }
      openWorkspaceTabInFocusedPane(
        persistenceKey,
        {
          kind: "working_diff",
          ...(path ? { focusPath: path, focusRequestId: Date.now() } : {}),
        },
        FOCUSED_PANE_PLACEMENT,
      );
    },
    [isMobile, openWorkspaceTabInFocusedPane, persistenceKey],
  );
  const toggleChanges = useCallback(() => {
    if (!persistenceKey || isMobile) {
      return;
    }
    openChanges();
  }, [isMobile, openChanges, persistenceKey]);
  const openCommit = useCallback(
    (sha: string) => {
      if (persistenceKey) {
        openWorkspaceTabInFocusedPane(
          persistenceKey,
          { kind: "commit_diff", sha },
          FOCUSED_PANE_PLACEMENT,
        );
      }
    },
    [openWorkspaceTabInFocusedPane, persistenceKey],
  );
  return {
    changesTabOpen,
    openChanges,
    toggleChanges,
    openCommit,
    onChangesFilePress: changesTabOpen ? openChanges : undefined,
  };
}

export function ChangesSurface({
  serverId,
  workspaceId,
  cwd,
  enabled,
  host,
  modeScope,
  focusPath,
  focusRequestId,
  focusLineStart,
  focusLineEnd,
  focusColumn,
  focusReveal,
  onActivate,
  onOpenFile,
  onAddToChat,
  state: changesState,
  onStateChange,
}: ChangesSurfaceProps) {
  const { settings: appSettings } = useAppSettings();
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const [paneWidth, setPaneWidth] = useState(0);
  const canUseSplitLayout = isWeb && !isMobile;
  const instanceState = resolveChangesState(changesState);
  const updateState = resolveStateChange(onStateChange);
  const wrapLines = instanceState.wrapLines;
  const desktopTreeVisible = instanceState.treeVisible;
  const effectiveLayout = resolveDiffLayout(instanceState.layout, canUseSplitLayout);
  const collapsedFilePaths = instanceState.collapsedFilePaths;
  const updateCollapsedFilePaths = useCallback(
    (paths: string[]) => updateState({ ...instanceState, collapsedFilePaths: paths }),
    [instanceState, updateState],
  );
  const updateCollapsedFolderPaths = useCallback(
    (paths: string[]) => updateState({ ...instanceState, collapsedFolderPaths: paths }),
    [instanceState, updateState],
  );
  const collapseState = useMemo(
    () => ({ paths: collapsedFilePaths, onChange: updateCollapsedFilePaths }),
    [collapsedFilePaths, updateCollapsedFilePaths],
  );

  const handleToggleWrapLines = useCallback(() => {
    updateState({ ...instanceState, wrapLines: !wrapLines });
  }, [instanceState, updateState, wrapLines]);

  const handleToggleHideWhitespace = useCallback(() => {
    updateState({
      ...instanceState,
      hideWhitespace: !instanceState.hideWhitespace,
    });
  }, [instanceState, updateState]);

  const handleToggleLayout = useCallback(() => {
    updateState({
      ...instanceState,
      layout: instanceState.layout === "unified" ? "split" : "unified",
    });
  }, [instanceState, updateState]);
  const codeFontSize = appSettings.codeFontSize;

  const overflowToggleStyle = useMemo(() => buildOverflowButtonStyle(isMobile), [isMobile]);

  const toast = useToast();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { targets: desktopOpenTargets } = useDesktopOpenTargets({
    isLocalExecution: isLocalDaemon,
  });
  const fileManagerTarget = desktopOpenTargets.find((target) => target.kind === "file-manager");
  const {
    changesTabOpen: workspaceChangesTabOpen,
    toggleChanges: handleToggleChangesTab,
    openCommit: handleCommitPress,
    onChangesFilePress: workspaceOnChangesFilePress,
  } = useDiffTabNavigation({ serverId, workspaceId, cwd, isMobile });
  const changesTabOpen = resolveChangesTabOpen(host, workspaceChangesTabOpen);
  const onChangesFilePress = resolveChangesFilePress(host, workspaceOnChangesFilePress);
  const refreshSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client);
  // COMPAT(fsEntryDuplicate): added in v0.3.0, remove gate after 2027-02-09.
  const fsEntryDuplicateEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fsEntryDuplicate === true,
  );
  const fileEditingSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceFileEditing === true,
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
    baseSelection,
    currentBranchName,
    hasUncommittedChanges,
    diffMode,
    selectUncommitted: handleSelectUncommitted,
    selectBase: handleSelectBase,
    files,
    comparisonIdentity,
    diffPayloadError,
    diffTooLarge,
    isDiffLoading,
    reviewActions: localReviewActions,
    reviewAttachment,
    contextExpansion,
    contextExpansionSupported,
    diffSearchSupported,
    fileReviews,
  } = useWorkingDiff({
    serverId,
    workspaceId: workspaceId ?? undefined,
    cwd,
    ignoreWhitespace: instanceState.hideWhitespace,
    enabled: enabled !== false,
    queryScope: modeScope,
  });
  const discussions = useChangesDiscussions({
    serverId,
    cwd,
    enabled: enabled !== false && isGit,
  });
  const discussionThreads = useMemo(
    () =>
      buildChangesDiscussionThreads({
        items: discussions.items,
        files,
        comparisonIdentity,
      }),
    [comparisonIdentity, discussions.items, files],
  );
  const forgeThreadsByTarget = useMemo(
    () => groupChangesDiscussionsByTarget(discussionThreads),
    [discussionThreads],
  );
  const [discussionInboxOpen, setDiscussionInboxOpen] = useState(false);
  const [focusedDiscussionId, setFocusedDiscussionId] = useState<string | null>(null);
  const handleOpenDiscussions = useCallback(() => {
    setFocusedDiscussionId(null);
    setDiscussionInboxOpen(true);
  }, []);
  const handleOpenForgeDiscussion = useCallback((threadId: string) => {
    setFocusedDiscussionId(threadId);
    setDiscussionInboxOpen(true);
  }, []);
  const handleCloseDiscussions = useCallback(() => {
    setDiscussionInboxOpen(false);
    setFocusedDiscussionId(null);
  }, []);
  const handleShowAllDiscussions = useCallback(() => setFocusedDiscussionId(null), []);
  const expandDiscussionLine = contextExpansion.expandLine;
  const reviewActions = useMemo(
    () => ({
      ...localReviewActions,
      forgeThreadsByTarget,
      onOpenForgeThread: handleOpenForgeDiscussion,
    }),
    [forgeThreadsByTarget, handleOpenForgeDiscussion, localReviewActions],
  );
  useEffect(() => {
    for (const item of discussions.items) {
      if (item.kind !== "comment" || !item.location?.line) continue;
      if ((item.location.side ?? "new") !== "new") continue;
      void expandDiscussionLine(item.location.path, item.location.line).catch(() => undefined);
    }
  }, [discussions.items, expandDiscussionLine]);
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
  const handleToggleDesktopTree = useCallback(() => {
    updateState({ ...instanceState, treeVisible: !desktopTreeVisible });
  }, [desktopTreeVisible, instanceState, updateState]);
  const handleCommitsCollapsedChange = useCallback(
    (commitsCollapsed: boolean) => updateState({ ...instanceState, commitsCollapsed }),
    [instanceState, updateState],
  );
  const handleChangesTreeWidth = useCallback(
    (treeWidth: number) => updateState({ ...instanceState, treeWidth }),
    [instanceState, updateState],
  );
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
          filePath: buildAbsoluteExplorerPath({ workspaceRoot: cwd, entryPath: path }),
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
  const [localFocusRequest, setLocalFocusRequest] = useState<ChangesFocusRequest | null>(null);
  const externalFocusRequest = useMemo(
    () =>
      createExternalFocusRequest({
        path: focusPath,
        revision: focusRequestId,
        lineStart: focusLineStart,
        lineEnd: focusLineEnd,
        column: focusColumn,
        reveal: focusReveal,
      }),
    [focusColumn, focusLineEnd, focusLineStart, focusPath, focusRequestId, focusReveal],
  );
  const documentFocusRequest = selectNewestFocusRequest(localFocusRequest, externalFocusRequest);
  const handleSelectTreeFile = useCallback((path: string) => {
    setLocalFocusRequest((current) => ({
      path,
      revision: nextFocusRevision(current),
      reveal: undefined,
    }));
  }, []);
  const handleNavigateDiscussion = useCallback(
    async (thread: ChangesDiscussionThread) => {
      if (!thread.targetPath || !thread.location?.line) return;
      if ((thread.location.side ?? "new") === "new") {
        await expandDiscussionLine(thread.targetPath, thread.location.line).catch(() => undefined);
      }
      setLocalFocusRequest((current) => ({
        path: thread.targetPath!,
        revision: nextFocusRevision(current),
        ...((thread.location?.side ?? "new") === "new"
          ? { lineStart: thread.location!.line, lineEnd: thread.location!.line }
          : {}),
        reveal: "center-if-hidden",
      }));
      setDiscussionInboxOpen(false);
    },
    [expandDiscussionLine],
  );
  const handleOpenLspDefinition = useCallback(
    (location: { path: string; lineStart: number; lineEnd: number }) => {
      onOpenFile?.(location.path);
    },
    [onOpenFile],
  );
  const handleEditLine = useCallback(
    (line: ReviewableChangedLine) => {
      const lineStart = line.target.editLineNumber;
      if (!lineStart) return;
      onOpenFile?.(line.target.filePath, { lineStart, openMode: "source" });
    },
    [onOpenFile],
  );
  const loadChangesLspSource = contextExpansion.loadSource;
  const expandSearchLine = contextExpansion.expandLine;
  const searchChanges = contextExpansion.search;
  useEffect(() => {
    if (!documentFocusRequest?.lineStart) return;
    void expandSearchLine(documentFocusRequest.path, documentFocusRequest.lineStart).catch(
      () => undefined,
    );
  }, [documentFocusRequest, expandSearchLine]);
  const changesLsp = useChangesLsp({
    serverId,
    cwd,
    active: enabled !== false,
    dirty: hasUncommittedChanges,
    loadSource: loadChangesLspSource,
    onOpenDefinition: handleOpenLspDefinition,
  });
  const revealSearchMatch = useCallback(
    async (match: ChangesSearchMatch) => {
      if (match.kind === "text") await expandSearchLine(match.filePath, match.lineNumber);
    },
    [expandSearchLine],
  );
  const workingMode = useMemo(
    () =>
      buildWorkingDiffMode({
        base: {
          reviewActions,
          fileReviews,
          onExpandFile: contextExpansion.expandFile,
          onActivate,
          onFilePress: onChangesFilePress,
          onOpenFile,
          onEditLine: onOpenFile && fileEditingSupported ? handleEditLine : undefined,
          onAddToChat,
          onCopyPath: handleCopyPath,
          onCopyRelativePath: handleCopyRelativePath,
          onReveal: handleRevealPath,
          revealTargetName: desktopTargetLabel(fileManagerTarget),
          onDownload: handleDownloadPath,
          onDuplicate: handleDuplicatePath,
          onRevert: onRevertPath,
          onSearch: searchChanges,
          searchSupported: diffSearchSupported,
          onRevealSearchMatch: revealSearchMatch,
          lsp: changesLsp,
          lspStatusPresentation: isMobile || (paneWidth > 0 && paneWidth < 480) ? "icon" : "label",
        },
        contextExpansionSupported,
        expandContext: contextExpansion.expand,
        focus: documentFocusRequest,
        serverId,
        workspaceId: workspaceId ?? undefined,
        revealAvailable: Boolean(fileManagerTarget),
        duplicateAvailable: fsEntryDuplicateEnabled,
      }),
    [
      reviewActions,
      fileReviews,
      contextExpansionSupported,
      contextExpansion.expand,
      contextExpansion.expandFile,
      onActivate,
      onChangesFilePress,
      documentFocusRequest,
      serverId,
      workspaceId,
      onOpenFile,
      fileEditingSupported,
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
      searchChanges,
      diffSearchSupported,
      revealSearchMatch,
      changesLsp,
      isMobile,
      paneWidth,
    ],
  );

  const hasChanges = files.length > 0;
  const navigatorOwner = useRef({});
  const selectedNavigatorPath = retainSelectedChangesFile(
    instanceState.selectedFilePath ?? null,
    files,
  );
  const fileNavigatorCollapsed = instanceState.fileNavigatorCollapsed ?? false;
  const navigatorFolders = useMemo(
    () => instanceState.fileNavigatorCollapsedFolders ?? [],
    [instanceState.fileNavigatorCollapsedFolders],
  );
  const setNavigatorState = useCallback(
    (patch: Partial<ChangesState>) => updateState({ ...instanceState, ...patch }),
    [instanceState, updateState],
  );
  useEffect(() => {
    if (instanceState.selectedFilePath && !selectedNavigatorPath) {
      setNavigatorState({ selectedFilePath: undefined });
    }
  }, [instanceState.selectedFilePath, selectedNavigatorPath, setNavigatorState]);
  const activateNavigatorFile = useCallback(
    (path: string) => {
      setLocalFocusRequest((current) => ({
        path,
        revision: nextFocusRevision(current),
      }));
      setNavigatorState({ selectedFilePath: path });
    },
    [setNavigatorState],
  );
  const toggleNavigatorFolder = useCallback(
    (path: string) => {
      setNavigatorState({
        fileNavigatorCollapsedFolders: navigatorFolders.includes(path)
          ? navigatorFolders.filter((candidate) => candidate !== path)
          : [...navigatorFolders, path],
      });
    },
    [navigatorFolders, setNavigatorState],
  );
  const toggleFileNavigator = useCallback(
    () => setNavigatorState({ fileNavigatorCollapsed: !fileNavigatorCollapsed }),
    [fileNavigatorCollapsed, setNavigatorState],
  );
  const workspaceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? cwd }),
    [cwd, serverId, workspaceId],
  );
  useEffect(() => {
    if (!workspaceKey) return;
    const owner = navigatorOwner.current;
    const snapshot = {
      files,
      isLoading: isDiffLoading,
      contextExpansionSupported,
    };
    if (host === "panel") {
      publishWorkingDiffNavigationSnapshot(workspaceKey, owner, {
        ...snapshot,
        tabId: modeScope,
      });
      return () => clearWorkingDiffNavigationSnapshot(workspaceKey, owner);
    }
    publishInlineWorkingDiffNavigationSnapshot(workspaceKey, owner, {
      ...snapshot,
      navigate: (target) => {
        setLocalFocusRequest({
          path: target.focusPath ?? "",
          revision: target.focusRequestId ?? Date.now(),
          lineStart: target.focusLineStart,
          lineEnd: target.focusLineEnd,
          column: target.focusColumn,
          reveal: target.focusReveal,
        });
        if (target.focusPath) setNavigatorState({ selectedFilePath: target.focusPath });
      },
    });
    return () => clearInlineWorkingDiffNavigationSnapshot(workspaceKey, owner);
  }, [
    contextExpansionSupported,
    files,
    host,
    isDiffLoading,
    modeScope,
    setNavigatorState,
    workspaceKey,
  ]);
  const { available: navigatorAvailable, shown: showFileNavigator } = resolveNavigatorVisibility({
    canUseSplitLayout,
    paneWidth,
    hasChanges,
    collapsed: fileNavigatorCollapsed,
  });
  const handlePaneLayout = useCallback((event: LayoutChangeEvent) => {
    setPaneWidth(event.nativeEvent.layout.width);
  }, []);
  const selectedDiffStat = useMemo(
    () => computeSelectedDiffStat(files, isDiffLoading),
    [files, isDiffLoading],
  );
  const allFilesCollapsed =
    hasChanges && files.every((file) => collapsedFilePaths.includes(file.path));
  const handleCollapseAllFiles = useCallback(
    () => updateCollapsedFilePaths(files.map((file) => file.path)),
    [files, updateCollapsedFilePaths],
  );
  const handleExpandAllFiles = useCallback(
    () => updateCollapsedFilePaths([]),
    [updateCollapsedFilePaths],
  );
  const handleMarkAllReviewed = useCallback(() => {
    fileReviews.markAll();
    updateCollapsedFilePaths(files.map((file) => file.path));
  }, [fileReviews, files, updateCollapsedFilePaths]);
  const handleMarkAllUnreviewed = useCallback(() => {
    fileReviews.clearAll();
  }, [fileReviews]);
  const handleOrganizeByReview = useCallback(() => {
    const filePaths = files.map((file) => file.path);
    const incompletePaths = filePaths.filter((path) => !fileReviews.reviewedPaths.has(path));
    updateState({
      ...instanceState,
      collapsedFilePaths: collapseReviewedFiles(filePaths, fileReviews.reviewedPaths),
      collapsedFolderPaths: revealFileAncestorFolders(
        instanceState.collapsedFolderPaths,
        incompletePaths,
      ),
      fileNavigatorCollapsedFolders: revealFileAncestorFolders(
        instanceState.fileNavigatorCollapsedFolders ?? [],
        incompletePaths,
      ),
    });
  }, [fileReviews.reviewedPaths, files, instanceState, updateState]);
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
  const emptyMessage = computeEmptyMessage(instanceState.hideWhitespace, diffMode, baseRefLabel, {
    hiddenWhitespace: t("workspace.git.diff.emptyHiddenWhitespace"),
    uncommitted: t("workspace.git.diff.emptyUncommitted"),
    againstBase: (label) => t("workspace.git.diff.emptyAgainstBase", { baseRef: label }),
  });
  const emptyAction = computeChangesEmptyAction({
    hideWhitespace: instanceState.hideWhitespace,
    diffMode,
    status,
    seeUncommittedLabel: t("workspace.git.diff.seeUncommittedChanges"),
    seeCommittedLabel: t("workspace.git.diff.seeCommittedChanges"),
    selectUncommitted: handleSelectUncommitted,
    selectBase: handleSelectBase,
  });
  const handleSelectComparisonBase = useCallback(
    (nextBaseRef: string | null) =>
      applyChangesBaseSelection({
        baseRef: nextBaseRef,
        setOverride: baseSelection.setOverride,
        showCommitted: handleSelectBase,
      }),
    [baseSelection.setOverride, handleSelectBase],
  );

  const diffContent: ReactElement = (
    <DiffBodyContent
      isStatusLoading={isStatusLoading}
      statusErrorMessage={statusErrorMessage}
      notGit={notGit}
      isDiffLoading={isDiffLoading}
      diffErrorMessage={diffErrorMessage}
      diffTooLarge={diffTooLarge}
      hasChanges={hasChanges}
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      checkingRepositoryLabel={t("workspace.git.diff.checkingRepository")}
      notRepositoryLabel={t("workspace.git.diff.notRepository")}
    >
      <DiffDocument
        files={files}
        collapseState={collapseState}
        displayPreferences={sharedDisplayPreferences}
        mode={workingMode}
      />
    </DiffBodyContent>
  );
  const bodyContent = (
    <ChangesTreeRail
      shown={desktopTreeVisible && !isMobile && files.length > 0}
      files={files}
      mode={workingMode}
      onSelectFile={handleSelectTreeFile}
      treeWidth={instanceState.treeWidth}
      onTreeWidthChange={handleChangesTreeWidth}
      collapsedFolderPaths={instanceState.collapsedFolderPaths}
      onCollapsedFolderPathsChange={updateCollapsedFolderPaths}
    >
      <View style={styles.diffBody}>{diffContent}</View>
    </ChangesTreeRail>
  );

  return (
    <View
      {...{
        onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
      }}
      style={styles.container}
      onLayout={handlePaneLayout}
    >
      {isGit ? (
        <ChangesToolbar
          branchName={currentBranchName}
          baseSelection={baseSelection}
          allFilesCollapsed={allFilesCollapsed}
          canUseSplitLayout={canUseSplitLayout}
          changesTabOpen={changesTabOpen}
          committedDescription={committedDiffDescription}
          cwd={cwd}
          desktopTreeVisible={desktopTreeVisible}
          fileNavigatorAvailable={navigatorAvailable}
          fileNavigatorCollapsed={fileNavigatorCollapsed}
          fileReviews={fileReviews}
          diffMode={diffMode}
          gitActions={gitActions}
          hasFiles={hasChanges}
          hasUncommittedChanges={hasUncommittedChanges}
          hideWhitespace={instanceState.hideWhitespace}
          host={host}
          isMobile={isMobile}
          isRefreshing={isRefreshing}
          layout={instanceState.layout}
          overflowToggleStyle={overflowToggleStyle}
          refreshSupported={refreshSupported}
          selectedDiffStat={selectedDiffStat}
          serverId={serverId}
          workspaceId={workspaceId}
          wrapLines={wrapLines}
          discussionCount={discussionThreads.filter(isOpenChangesDiscussion).length}
          showDiscussionControl={discussions.isGitLabMr}
          onOpenDiscussions={handleOpenDiscussions}
          onCollapseAll={handleCollapseAllFiles}
          onExpandAll={handleExpandAllFiles}
          onMarkAllReviewed={handleMarkAllReviewed}
          onMarkAllUnreviewed={handleMarkAllUnreviewed}
          onOrganizeByReview={handleOrganizeByReview}
          onRefresh={handleRefresh}
          onSelectBase={handleSelectBase}
          onSelectComparisonBase={handleSelectComparisonBase}
          onSelectUncommitted={handleSelectUncommitted}
          onToggleChangesTab={handleToggleChangesTab}
          onToggleDesktopTree={handleToggleDesktopTree}
          onToggleFileNavigator={toggleFileNavigator}
          onToggleHideWhitespace={handleToggleHideWhitespace}
          onToggleLayout={handleToggleLayout}
          onToggleWrapLines={handleToggleWrapLines}
        />
      ) : null}

      {forgeSetupMessage ? (
        <View style={styles.forgeSetupCallout} testID="forge-setup-callout">
          <Text style={styles.forgeSetupCalloutText}>{forgeSetupMessage}</Text>
        </View>
      ) : null}

      {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}

      <View style={styles.diffContainer}>
        {bodyContent}
        {showFileNavigator ? (
          <ChangesFileTreeNavigator
            files={files}
            selectedPath={selectedNavigatorPath}
            collapsedFolders={navigatorFolders}
            onActivateFile={activateNavigatorFile}
            onToggleFolder={toggleNavigatorFolder}
            onCollapse={toggleFileNavigator}
          />
        ) : null}
      </View>

      <CommitsSection
        serverId={serverId}
        cwd={cwd}
        onCommitPress={handleCommitPress}
        collapsed={instanceState.commitsCollapsed}
        onCollapsedChange={handleCommitsCollapsedChange}
      />
      <ChangesDiscussionInbox
        visible={discussionInboxOpen}
        onClose={handleCloseDiscussions}
        focusedThreadId={focusedDiscussionId}
        onShowAllThreads={handleShowAllDiscussions}
        threads={discussionThreads}
        truncated={discussions.truncated}
        mrUrl={discussions.mrUrl}
        isRefreshing={discussions.isRefreshing}
        upgradeRequired={discussions.isGitLabMr && !discussions.supported}
        error={discussions.error}
        onRefresh={discussions.refresh}
        onNavigate={handleNavigateDiscussion}
        onReply={discussions.reply}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  changesToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  changesToolbarIdentity: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  changesToolbarControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  diffModeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
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
  diffStatusText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.25,
    color: theme.colors.foregroundMuted,
  },
  diffStatusIconHidden: {
    opacity: 0,
  },
  actionErrorText: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
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
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  diffContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    flexDirection: "row",
  },
  diffBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
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
    gap: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
