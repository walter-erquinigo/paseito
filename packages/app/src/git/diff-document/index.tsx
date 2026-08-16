import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { RenderProfile } from "@/utils/render-profiler";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useToast } from "@/contexts/toast-context";
import { isWeb } from "@/constants/platform";
import { formatShortcut } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { buildDiffContextRegions } from "@/git/diff-context-expansion";
import {
  findAdjacentHiddenContext,
  findNextUncheckedLine,
  getLineReviewKeyboardAction,
} from "@/review/line-review-navigation";
import type { ReviewableChangedLine } from "@/review";
import { createDiffPalette, retainDiffPalette } from "./palette";
import { DiffSurface } from "./surface";
import type { DiffDocumentProps, DiffPalette } from "./types";
import type { LspHoverVisualTheme } from "@/file-pane/editor/lsp-hover-markdown.web";

export type { DiffDocumentProps, WorkingDiffMode } from "./types";

type ThemedDiffDocumentProps = DiffDocumentProps & {
  palette: DiffPalette;
  hoverTheme: LspHoverVisualTheme;
};

const EMPTY_PATHS: string[] = [];

type WorkingMode = Extract<DiffDocumentProps["mode"], { kind: "working" }>;
type FileReviews = NonNullable<WorkingMode["fileReviews"]>;

interface LineReviewKeyboardContext {
  fileReviews: FileReviews;
  files: DiffDocumentProps["files"];
  mode: WorkingMode;
  orderedLines: ReviewableChangedLine[];
  selectedLine: ReviewableChangedLine;
  clearSelection: () => void;
  editLine: (line: ReviewableChangedLine) => void;
  expandFile: (path: string) => void;
  selectLine: (line: ReviewableChangedLine) => void;
  showNoUncheckedLines: () => void;
  toggleLine: (line: ReviewableChangedLine) => void;
}

function eventTargetsEditor(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element &&
    Boolean(event.target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function moveLineReviewSelection(direction: "down" | "up", context: LineReviewKeyboardContext) {
  const reviewed = new Set(context.fileReviews.reviewedLineIds);
  reviewed.add(context.selectedLine.id);
  if (!context.fileReviews.reviewedLineIds.has(context.selectedLine.id)) {
    context.fileReviews.markLine(context.selectedLine);
  }
  const next = findNextUncheckedLine({
    lines: context.orderedLines,
    selectedLineId: context.selectedLine.id,
    reviewedLineIds: reviewed,
    direction,
  });
  if (!next) {
    context.clearSelection();
    context.showNoUncheckedLines();
    return;
  }
  context.expandFile(next.target.filePath);
  context.selectLine(next);
}

function expandLineReviewContext(direction: "above" | "below", context: LineReviewKeyboardContext) {
  if (!context.mode.onExpandContext) return;
  const file = context.files.find((entry) => entry.path === context.selectedLine.target.filePath);
  const lineNumber =
    context.selectedLine.target.newLineNumber ?? context.selectedLine.target.lineNumber;
  if (!file || !lineNumber) return;
  const region = findAdjacentHiddenContext({
    regions: buildDiffContextRegions(file),
    lineNumber,
    direction,
  });
  if (region) {
    void context.mode.onExpandContext(context.selectedLine.target.filePath, region, "all");
  }
}

function handleLineReviewKeyDown(event: KeyboardEvent, context: LineReviewKeyboardContext) {
  if (
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    eventTargetsEditor(event)
  ) {
    return;
  }
  const action = getLineReviewKeyboardAction(event.key);
  if (!action) return;
  event.preventDefault();
  if (action === "clear") return context.clearSelection();
  if (action === "toggle") return context.toggleLine(context.selectedLine);
  if (action === "edit") return context.editLine(context.selectedLine);
  if (action === "move-down" || action === "move-up") {
    moveLineReviewSelection(action === "move-down" ? "down" : "up", context);
    return;
  }
  if (action === "expand-above" || action === "expand-below") {
    expandLineReviewContext(action === "expand-below" ? "below" : "above", context);
  }
}

function ThemedDiffDocument(props: ThemedDiffDocumentProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const paletteRef = useRef(props.palette);
  paletteRef.current = retainDiffPalette(paletteRef.current, props.palette);
  const palette = paletteRef.current;
  const collapseState = props.mode.kind === "working" ? props.collapseState : null;
  const paths = collapseState?.paths ?? EMPTY_PATHS;
  const collapsedFilePaths = useMemo(() => new Set(paths), [paths]);
  const toggleFile = useCallback(
    (path: string) => {
      if (!collapseState) return;
      const next = collapsedFilePaths.has(path)
        ? paths.filter((entry) => entry !== path)
        : [...paths, path];
      collapseState.onChange(next);
    },
    [collapseState, collapsedFilePaths, paths],
  );
  const review = useDiffDocumentReview({
    files: props.files,
    mode: props.mode,
    collapsedFilePaths,
    toggleFile,
  });
  return (
    <DiffSurface
      {...props}
      palette={palette}
      collapsedFilePaths={collapsedFilePaths}
      onToggleFile={toggleFile}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
      reviewPresentation={review}
    />
  );
}

function useDiffDocumentReview({
  files,
  mode,
  collapsedFilePaths,
  toggleFile,
}: {
  files: DiffDocumentProps["files"];
  mode: DiffDocumentProps["mode"];
  collapsedFilePaths: ReadonlySet<string>;
  toggleFile: (path: string) => void;
}) {
  const toast = useToast();
  const { t } = useTranslation();
  const focusChangesKeys = useShortcutKeys("focus-changes");
  const focusChangesShortcut = focusChangesKeys?.[0]
    ? formatShortcut(focusChangesKeys[0], getShortcutOs())
    : null;
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const handlerId = useRef(`diff-document-focus:${Math.random().toString(36).slice(2)}`);
  const fileReviews = mode.kind === "working" ? mode.fileReviews : undefined;
  const orderedLines = useMemo(
    () =>
      fileReviews
        ? files.flatMap(
            (file) => fileReviews.files.find((entry) => entry.path === file.path)?.lines ?? [],
          )
        : [],
    [fileReviews, files],
  );
  const selectedLine = orderedLines.find((line) => line.id === selectedLineId) ?? null;
  const expandFile = useCallback(
    (path: string) => {
      if (mode.kind === "working" && collapsedFilePaths.has(path)) toggleFile(path);
    },
    [collapsedFilePaths, mode, toggleFile],
  );
  const collapseFile = useCallback(
    (path: string) => {
      if (mode.kind === "working" && !collapsedFilePaths.has(path)) toggleFile(path);
    },
    [collapsedFilePaths, mode, toggleFile],
  );
  const selectLine = useCallback((line: ReviewableChangedLine) => {
    setSelectedLineId(line.id);
    setFocusRequest((value) => value + 1);
  }, []);
  const toggleLine = useCallback(
    (line: ReviewableChangedLine) => {
      if (!fileReviews) return;
      const wasReviewed = fileReviews.reviewedLineIds.has(line.id);
      fileReviews.toggleLine(line);
      const progress = fileReviews.lineProgressByPath.get(line.target.filePath);
      if (!wasReviewed && progress && progress.reviewed + 1 === progress.total) {
        collapseFile(line.target.filePath);
        setSelectedLineId(null);
      }
    },
    [collapseFile, fileReviews],
  );
  const editLine = useCallback(
    (line: ReviewableChangedLine) => {
      if (mode.kind === "working" && mode.onEditLine && line.target.editLineNumber) {
        mode.onEditLine(line);
        return;
      }
      toast.show(t("workspace.git.diff.editLineUnavailable"));
    },
    [mode, t, toast],
  );
  const focusChanges = useCallback(() => {
    if (mode.kind === "working") mode.onActivate?.();
    const target =
      selectedLine ??
      orderedLines.find((line) => !fileReviews?.reviewedLineIds.has(line.id)) ??
      orderedLines[0];
    if (target) {
      expandFile(target.target.filePath);
      selectLine(target);
      return true;
    }
    if (files[0]) {
      expandFile(files[0].path);
      setFocusRequest((value) => value + 1);
      return true;
    }
    return false;
  }, [
    expandFile,
    fileReviews?.reviewedLineIds,
    files,
    mode,
    orderedLines,
    selectLine,
    selectedLine,
  ]);
  useKeyboardActionHandler({
    handlerId: handlerId.current,
    actions: ["changes.focus"],
    enabled: mode.kind === "working",
    priority: 250,
    handle: focusChanges,
  });
  useEffect(() => {
    if (!isWeb || mode.kind !== "working" || !fileReviews || !selectedLine) return;
    const context: LineReviewKeyboardContext = {
      fileReviews,
      files,
      mode,
      orderedLines,
      selectedLine,
      clearSelection: () => setSelectedLineId(null),
      editLine,
      expandFile,
      selectLine,
      showNoUncheckedLines: () => toast.show("No unchecked lines"),
      toggleLine,
    };
    const onKeyDown = (event: KeyboardEvent) => handleLineReviewKeyDown(event, context);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editLine,
    expandFile,
    fileReviews,
    files,
    mode,
    orderedLines,
    selectedLine,
    selectLine,
    toast,
    toggleLine,
  ]);
  if (mode.kind !== "working" || !fileReviews?.available) return undefined;
  return {
    selectedLineId,
    shortcutHint:
      selectedLine && !mode.reviewActions?.editor && !mode.reviewActions?.suggestionEditor
        ? `${focusChangesShortcut ? `${t("workspace.git.diff.focusChangesShortcut", { shortcut: focusChangesShortcut })} · ` : ""}${t("workspace.git.diff.lineReviewShortcuts")}`
        : null,
    onSelectLine: selectLine,
    onToggleLine: toggleLine,
    onToggleFile: fileReviews.toggle,
    onExpandContext: mode.onExpandContext,
    focusRequest,
  };
}

const StyledDiffDocument = withUnistyles(ThemedDiffDocument, (theme) => ({
  palette: createDiffPalette(theme),
  hoverTheme: {
    border: theme.colors.border,
    codeBackground: theme.colors.surface2,
    codeFontSize: theme.fontSize.code,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    monoFont: theme.fontFamily.mono,
    surfaceRaised: theme.colors.surface3,
    uiFont: theme.fontFamily.ui,
  },
}));

export function DiffDocument(props: DiffDocumentProps) {
  return (
    <RenderProfile id="DiffDocument">
      <StyledDiffDocument {...props} />
    </RenderProfile>
  );
}
