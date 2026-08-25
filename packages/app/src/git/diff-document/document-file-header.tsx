import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ListChevronsUpDown } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileHeader } from "@/git/file-header";
import type { DiffFileSection } from "./types";
import type { DiffDocumentProps } from "./types";
import { LspStatusMenu } from "@/file-pane/lsp-status-menu";
import { lspLanguageForFile } from "@/file-pane/editor/lsp-preferences";
import type { ChangesLspController } from "@/git/use-changes-lsp";
import { buildDiffContextRegions } from "@/git/diff-context-expansion";
import { ReviewCheckbox } from "./review-checkbox";
import type { ReviewCheckboxState } from "./review-checkbox-model";

interface DocumentFileHeaderProps {
  file: DiffFileSection;
  selectedPath: string | null;
  mode: DiffDocumentProps["mode"];
  onToggleFile: (path: string) => void;
  onSelectPath: (path: string) => void;
  onFocusDocument?: () => void;
}

export const DocumentFileHeader = memo(function DocumentFileHeader({
  file,
  selectedPath,
  mode,
  onToggleFile,
  onSelectPath,
  onFocusDocument,
}: DocumentFileHeaderProps) {
  if (mode.kind === "commit") {
    return (
      <FileHeader
        file={file.file}
        bodyVisible={!file.isCollapsed}
        isSelected={selectedPath === file.path}
        interactive={false}
        onActivate={onToggleFile}
        onSelect={onSelectPath}
        testID={`diff-file-${file.fileIndex}`}
      />
    );
  }
  return (
    <WorkingDocumentFileHeader
      file={file}
      selectedPath={selectedPath}
      mode={mode}
      onToggleFile={onToggleFile}
      onSelectPath={onSelectPath}
      onFocusDocument={onFocusDocument}
    />
  );
}, documentFileHeaderPropsEqual);

function WorkingDocumentFileHeader({
  file,
  selectedPath,
  mode,
  onToggleFile,
  onSelectPath,
  onFocusDocument,
}: DocumentFileHeaderProps & { mode: Extract<DiffDocumentProps["mode"], { kind: "working" }> }) {
  const activate = useCallback(
    (path: string) => {
      mode.onFilePress?.(path);
      onToggleFile(path);
    },
    [mode, onToggleFile],
  );
  const onExpandFile = mode.onExpandFile;
  const expandFile = useCallback(async () => {
    await onExpandFile?.(file.path);
    onFocusDocument?.();
  }, [file.path, onExpandFile, onFocusDocument]);
  const reviewControl = useMemo(
    () => <DocumentFileReviewControl file={file} mode={mode} onToggleFile={onToggleFile} />,
    [file, mode, onToggleFile],
  );
  const canExpandCompleteFile = Boolean(
    onExpandFile && buildDiffContextRegions(file.file).length > 0,
  );
  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        {canExpandCompleteFile ? (
          <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Button
                accessibilityLabel={`Show entire ${file.path} file`}
                leftIcon={ListChevronsUpDown}
                onPress={expandFile}
                size="xs"
                style={styles.expandFileControl}
                testID={`diff-file-${file.fileIndex}-expand-file`}
                variant="ghost"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <Text style={styles.tooltipText}>Show entire file</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {mode.lsp ? (
          <DocumentFileLspStatus
            filePath={file.path}
            lsp={mode.lsp}
            presentation={mode.lspStatusPresentation ?? "label"}
          />
        ) : null}
        {reviewControl}
      </View>
    ),
    [
      canExpandCompleteFile,
      expandFile,
      file.fileIndex,
      file.path,
      mode.lsp,
      mode.lspStatusPresentation,
      reviewControl,
    ],
  );
  return (
    <View style={styles.root}>
      <FileHeader
        file={file.file}
        bodyVisible={!file.isCollapsed}
        isSelected={selectedPath === file.path}
        interactive
        workspaceFileDragScope={mode.workspaceFileDragScope}
        onActivate={activate}
        onSelect={onSelectPath}
        onOpenFile={mode.onOpenFile}
        onAddToChat={mode.onAddToChat}
        onCopyPath={mode.onCopyPath}
        onCopyRelativePath={mode.onCopyRelativePath}
        onReveal={mode.onReveal}
        revealTargetName={mode.revealTargetName}
        onDownload={mode.onDownload}
        onDuplicate={mode.onDuplicate}
        onRevert={mode.onRevert}
        trailingContent={headerActions}
        testID={`diff-file-${file.fileIndex}`}
      />
    </View>
  );
}

function DocumentFileReviewControl({
  file,
  mode,
  onToggleFile,
}: {
  file: DiffFileSection;
  mode: Extract<DiffDocumentProps["mode"], { kind: "working" }>;
  onToggleFile: (path: string) => void;
}) {
  const reviews = mode.fileReviews;
  const progress = reviews?.lineProgressByPath.get(file.path);
  const reviewed = reviews?.reviewedPaths.has(file.path) === true;
  const partiallyReviewed = Boolean(progress && progress.reviewed > 0);
  let reviewState: ReviewCheckboxState = "unreviewed";
  if (reviewed) reviewState = "reviewed";
  else if (partiallyReviewed) reviewState = "mixed";
  const toggleReview = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      const nextReviewed = reviews?.toggle(file.path);
      if (nextReviewed !== undefined && file.isCollapsed !== nextReviewed) {
        onToggleFile(file.path);
      }
    },
    [file.isCollapsed, file.path, onToggleFile, reviews],
  );
  if (!reviews?.available || !file.file.contentRevision) return null;
  return (
    <ReviewCheckbox
      accessibilityLabel={reviewed ? "Mark file unreviewed" : "Mark file reviewed"}
      alwaysVisible
      onPress={toggleReview}
      state={reviewState}
      style={styles.headerControl}
      testID={`diff-file-review-${file.path}`}
    />
  );
}

function DocumentFileLspStatus({
  filePath,
  lsp,
  presentation,
}: {
  filePath: string;
  lsp: ChangesLspController;
  presentation: "label" | "icon";
}) {
  const language = lspLanguageForFile(filePath);
  const subscribe = useCallback(
    (listener: () => void) => lsp.subscribeFile(filePath, listener),
    [filePath, lsp],
  );
  const getSnapshot = useCallback(() => lsp.getFileSnapshot(filePath), [filePath, lsp]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!language || !lsp.supported) return;
    return lsp.acquireVisibleFile(filePath);
  }, [filePath, language, lsp]);
  const retry = useCallback(() => lsp.retry(filePath), [filePath, lsp]);
  if (!language || !lsp.supported) return null;
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
      presentation={presentation}
      testIDPrefix={`changes-lsp-${filePath}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { position: "relative" },
  headerControl: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  expandFileControl: {
    width: 24,
    height: 24,
    paddingHorizontal: 0,
  },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));

function documentFileHeaderPropsEqual(
  previous: DocumentFileHeaderProps,
  next: DocumentFileHeaderProps,
): boolean {
  if (!documentFileHeaderIdentityMatches(previous, next)) return false;
  if (previous.mode.kind === "commit" || next.mode.kind === "commit") return true;
  return (
    documentFileHeaderWorkingModeMatches(previous.mode, next.mode) &&
    previous.onFocusDocument === next.onFocusDocument
  );
}

function documentFileHeaderWorkingModeMatches(
  previous: Extract<DiffDocumentProps["mode"], { kind: "working" }>,
  next: Extract<DiffDocumentProps["mode"], { kind: "working" }>,
): boolean {
  return (
    previous.onFilePress === next.onFilePress &&
    previous.workspaceFileDragScope === next.workspaceFileDragScope &&
    previous.onOpenFile === next.onOpenFile &&
    previous.onAddToChat === next.onAddToChat &&
    previous.onCopyPath === next.onCopyPath &&
    previous.onCopyRelativePath === next.onCopyRelativePath &&
    previous.onReveal === next.onReveal &&
    previous.revealTargetName === next.revealTargetName &&
    previous.onDownload === next.onDownload &&
    previous.onDuplicate === next.onDuplicate &&
    previous.onRevert === next.onRevert &&
    previous.onExpandFile === next.onExpandFile &&
    previous.onSearch === next.onSearch &&
    previous.onRevealSearchMatch === next.onRevealSearchMatch &&
    previous.searchSupported === next.searchSupported &&
    previous.lsp === next.lsp &&
    previous.lspStatusPresentation === next.lspStatusPresentation
  );
}

function documentFileHeaderIdentityMatches(
  previous: DocumentFileHeaderProps,
  next: DocumentFileHeaderProps,
): boolean {
  return !(
    previous.file.file !== next.file.file ||
    previous.file.fileIndex !== next.file.fileIndex ||
    previous.file.isCollapsed !== next.file.isCollapsed ||
    (previous.selectedPath === previous.file.path) !== (next.selectedPath === next.file.path) ||
    previous.onToggleFile !== next.onToggleFile ||
    previous.onSelectPath !== next.onSelectPath ||
    previous.mode.kind !== next.mode.kind
  );
}
