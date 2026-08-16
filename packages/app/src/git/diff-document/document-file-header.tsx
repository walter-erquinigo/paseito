import { memo, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
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
        onOpenToSide={mode.onOpenToSide}
        onAddToChat={mode.onAddToChat}
        onCopyPath={mode.onCopyPath}
        onCopyRelativePath={mode.onCopyRelativePath}
        onReveal={mode.onReveal}
        revealTargetName={mode.revealTargetName}
        onDownload={mode.onDownload}
        onDuplicate={mode.onDuplicate}
        onRevert={mode.onRevert}
        testID={`diff-file-${file.fileIndex}`}
      />
      {onExpandFile && buildDiffContextRegions(file.file).length > 0 ? (
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
      {mode.lsp ? <DocumentFileLspStatus filePath={file.path} lsp={mode.lsp} /> : null}
      <DocumentFileReviewControl file={file} mode={mode} onToggleFile={onToggleFile} />
    </View>
  );
}

function fileReviewIndicator(reviewed: boolean, partiallyReviewed: boolean): "✓" | "−" | "○" {
  if (reviewed) return "✓";
  if (partiallyReviewed) return "−";
  return "○";
}

function fileReviewCheckedState(reviewed: boolean, partiallyReviewed: boolean) {
  if (reviewed) return true;
  if (partiallyReviewed) return "mixed" as const;
  return false;
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
  const checked = fileReviewCheckedState(reviewed, partiallyReviewed);
  const accessibilityState = useMemo(() => ({ checked }), [checked]);
  const toggleReview = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      reviews?.toggle(file.path);
      if (reviewed && file.isCollapsed) onToggleFile(file.path);
    },
    [file.isCollapsed, file.path, onToggleFile, reviewed, reviews],
  );
  if (!reviews?.available || !file.file.contentRevision) return null;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={reviewed ? "Mark file unreviewed" : "Mark file reviewed"}
      onPress={toggleReview}
      style={styles.reviewControl}
      testID={`diff-file-review-${file.path}`}
    >
      <Text style={styles.reviewText}>{fileReviewIndicator(reviewed, partiallyReviewed)}</Text>
    </Pressable>
  );
}

function DocumentFileLspStatus({ filePath, lsp }: { filePath: string; lsp: ChangesLspController }) {
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
      testIDPrefix={`changes-lsp-${filePath}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { position: "relative" },
  reviewControl: {
    position: "absolute",
    right: 8,
    top: 4,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 8,
  },
  expandFileControl: {
    position: "absolute",
    right: 34,
    top: 1,
    width: 28,
    paddingHorizontal: 0,
    zIndex: 8,
  },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  reviewText: { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 18 },
}));

function documentFileHeaderPropsEqual(
  previous: DocumentFileHeaderProps,
  next: DocumentFileHeaderProps,
): boolean {
  if (!documentFileHeaderIdentityMatches(previous, next)) return false;
  if (previous.mode.kind === "commit" || next.mode.kind === "commit") return true;
  return (
    previous.mode.onFilePress === next.mode.onFilePress &&
    previous.mode.workspaceFileDragScope === next.mode.workspaceFileDragScope &&
    previous.mode.onOpenFile === next.mode.onOpenFile &&
    previous.mode.onAddToChat === next.mode.onAddToChat &&
    previous.mode.onCopyPath === next.mode.onCopyPath &&
    previous.mode.onCopyRelativePath === next.mode.onCopyRelativePath &&
    previous.mode.onReveal === next.mode.onReveal &&
    previous.mode.revealTargetName === next.mode.revealTargetName &&
    previous.mode.onDownload === next.mode.onDownload &&
    previous.mode.onDuplicate === next.mode.onDuplicate &&
    previous.mode.onRevert === next.mode.onRevert &&
    previous.mode.onExpandFile === next.mode.onExpandFile &&
    previous.mode.onSearch === next.mode.onSearch &&
    previous.mode.onRevealSearchMatch === next.mode.onRevealSearchMatch &&
    previous.mode.searchSupported === next.mode.searchSupported &&
    previous.mode.lsp === next.mode.lsp &&
    previous.onFocusDocument === next.onFocusDocument
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
