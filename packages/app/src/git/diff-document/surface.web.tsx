import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, type ViewStyle } from "react-native";
import { DomOverlayScrollbar } from "@/components/ui/overlay-scrollbar/dom-overlay-scrollbar";
import { getInlineReviewThreadState, InlineReviewGutterCell, InlineReviewThread } from "@/review";
import type { ReviewableDiffTarget } from "@/utils/diff-layout";
import { DocumentFileHeader } from "./document-file-header";
import { parseDiffContextMarker, type DiffContextRegion } from "@/git/diff-context-expansion";
import { hitTestDiffDocument, selectedSourceText } from "./hit-testing";
import { retainHorizontalOffsetMapForPaths } from "./horizontal-offsets";
import { HorizontalScroll } from "./horizontal-scroll.web";
import {
  buildDiffDocumentModel,
  FILE_HEADER_HEIGHT,
  fragmentWidthForRange,
  resolveRelayoutScrollTop,
  retainReusableModels,
} from "./model";
import { paintWebViewport } from "./paint.web";
import { hasPointerDragStarted } from "./pointer-gesture";
import { createMeasuredAdvances } from "./text-measurement";
import { retainDiffViewport } from "./viewport";
import type {
  DiffCell,
  DiffDocumentModel,
  DiffSelection,
  DiffSurfaceProps,
  DiffTypography,
  TextMeasurer,
} from "./types";
import type { ChangesSearchMatch } from "@/git/changes-search";

const DEFAULT_MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const RESIZE_SETTLE_DELAY_MS = 120;

interface ChangesSearchState {
  open: boolean;
  query: string;
  matches: ChangesSearchMatch[];
  selected: number;
  status: "idle" | "loading" | "ready" | "error";
  truncated: boolean;
  error: string | null;
}

function changesSearchStatusLabel(search: ChangesSearchState): string | null {
  if (search.status === "loading") return "Searching…";
  if (search.status === "error") return search.error;
  if (search.matches.length > 0) {
    return `${search.selected + 1}/${search.matches.length}${search.truncated ? "+" : ""}`;
  }
  if (search.status === "ready") return "No matches";
  return "Enter to search";
}

function horizontalOffsetForSourceColumn(input: {
  cell: DiffCell;
  column: number;
  gutterWidth: number;
  viewportWidth: number;
}): number {
  const sourceOffset = Math.min(input.cell.content.length, Math.max(0, input.column - 1));
  const fragment =
    input.cell.fragments.find(
      (candidate) => candidate.start <= sourceOffset && sourceOffset <= candidate.end,
    ) ?? input.cell.fragments.at(-1);
  const textAdvance = fragment ? fragmentWidthForRange(fragment, fragment.start, sourceOffset) : 0;
  const visibleCodeWidth = Math.max(1, input.viewportWidth - input.gutterWidth);
  return Math.max(0, input.gutterWidth + 8 + textAdvance - visibleCodeWidth * 0.75);
}

function navigationColumnOffset(
  model: DiffDocumentModel,
  navigation: {
    focusPath?: string;
    focusRequestId?: number;
    focusLineStart?: number;
    focusLineEnd?: number;
    focusColumn?: number;
  } | null,
): { path: string; offset: number; requestKey: string } | null {
  if (
    model.wrapLines ||
    !navigation?.focusPath ||
    !navigation.focusLineStart ||
    !navigation.focusColumn
  ) {
    return null;
  }
  const lineEnd = navigation.focusLineEnd ?? navigation.focusLineStart;
  const row = model.rows.find(
    (candidate) =>
      candidate.kind === "line" &&
      candidate.path === navigation.focusPath &&
      candidate.cells.some(
        (cell) =>
          cell?.sourceIdentity.side === "new" &&
          cell.lineNumber !== null &&
          cell.lineNumber >= navigation.focusLineStart! &&
          cell.lineNumber <= lineEnd,
      ),
  );
  if (row?.kind !== "line") return null;
  const cell = row.cells.find(
    (candidate) => candidate?.sourceIdentity.side === "new" && candidate.lineNumber !== null,
  );
  const file = model.files[row.fileIndex];
  if (!cell || !file) return null;
  return {
    path: file.path,
    offset: horizontalOffsetForSourceColumn({
      cell,
      column: navigation.focusColumn,
      gutterWidth: file.gutterWidth,
      viewportWidth: model.viewportWidth,
    }),
    requestKey: `${navigation.focusRequestId ?? "initial"}:${navigation.focusPath}:${navigation.focusLineStart}:${lineEnd}:${navigation.focusColumn}`,
  };
}

function navigationMarkers(
  model: DiffDocumentModel,
  navigation: { filePath: string; lineStart: number; lineEnd: number },
): Array<{
  key: string;
  path: string;
  lineNumber: number;
  style: React.CSSProperties;
}> {
  const markers: Array<{
    key: string;
    path: string;
    lineNumber: number;
    style: React.CSSProperties;
  }> = [];
  for (const row of model.rows) {
    if (row.kind !== "line" || row.path !== navigation.filePath) continue;
    const columnWidth = model.viewportWidth / row.cells.length;
    row.cells.forEach((cell, cellIndex) => {
      if (
        cell?.sourceIdentity.side !== "new" ||
        cell.lineNumber === null ||
        cell.lineNumber < navigation.lineStart ||
        cell.lineNumber > navigation.lineEnd
      )
        return;
      markers.push({
        key: `${row.index}:${cellIndex}`,
        path: row.path,
        lineNumber: cell.lineNumber,
        style: {
          position: "absolute",
          top: row.top,
          left: cellIndex * columnWidth,
          width: columnWidth,
          height: row.height - row.reviewHeight,
          zIndex: 3,
          pointerEvents: "none",
        },
      });
    });
  }
  return markers;
}

export function DiffSurface(props: DiffSurfaceProps) {
  const { t } = useTranslation();
  const onToggleFile = props.onToggleFile;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasScratchRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ReturnType<typeof buildDiffDocumentModel> | null>(null);
  const previousModelRef = useRef<ReturnType<typeof buildDiffDocumentModel> | null>(null);
  const reusableModelRef = useRef<{
    dependencies: readonly unknown[];
    models: ReturnType<typeof buildDiffDocumentModel>[];
  } | null>(null);
  const consumedFocusRef = useRef<string | null>(null);
  const consumedReviewFocusRef = useRef<string | null>(null);
  const scrollTopRef = useRef(0);
  const horizontalOffsetsRef = useRef(new Map<string, number>());
  const selectionRef = useRef<DiffSelection | null>(null);
  const dragRef = useRef<{
    anchor: DiffSelection["anchor"];
    startX: number;
    startY: number;
    moved: boolean;
    dismissSelectionOnClick: boolean;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const resizeSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeReleaseFrameRef = useRef<number | null>(null);
  const resizePointerActiveRef = useRef(false);
  const pendingViewportRef = useRef({ width: 0, height: 0 });
  const forcePaintRef = useRef(true);
  const canvasWindowRef = useRef({ top: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [loadedTypography, setLoadedTypography] = useState<DiffTypography | null>(null);
  const [search, setSearch] = useState<ChangesSearchState>({
    open: false,
    query: "",
    matches: [],
    selected: -1,
    status: "idle",
    truncated: false,
    error: null,
  });
  const [lspHover, setLspHover] = useState<{ text: string; left: number; top: number } | null>(
    null,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const family = props.displayPreferences.monoFontFamily.trim() || DEFAULT_MONO_STACK;
  useLayoutEffect(() => {
    const stats = (window as typeof window & { __PASEO_DIFF_REACT_STATS__?: { commits: number } })
      .__PASEO_DIFF_REACT_STATS__;
    if (stats) stats.commits += 1;
  });
  const desiredTypography = useMemo<DiffTypography>(
    () => ({
      family,
      size: props.displayPreferences.codeFontSize,
      lineHeight: Math.round(props.displayPreferences.codeFontSize * 1.5),
    }),
    [family, props.displayPreferences.codeFontSize],
  );
  const measurement = useMemo(
    () => (loadedTypography ? createWebTextMeasurer(loadedTypography) : null),
    [loadedTypography],
  );
  const reviewActions = props.mode.kind === "working" ? props.mode.reviewActions : undefined;
  const workingMode = props.mode.kind === "working" ? props.mode : null;
  const navigationHighlight = useMemo(() => {
    if (!workingMode?.focusPath || !workingMode.focusLineStart) return undefined;
    return {
      filePath: workingMode.focusPath,
      lineStart: workingMode.focusLineStart,
      lineEnd: Math.max(
        workingMode.focusLineStart,
        workingMode.focusLineEnd ?? workingMode.focusLineStart,
      ),
    };
  }, [workingMode]);
  const effectiveNavigationHighlight = useMemo(() => {
    const selectedSearchMatch = search.matches[search.selected];
    if (selectedSearchMatch?.kind === "text") {
      return {
        filePath: selectedSearchMatch.filePath,
        lineStart: selectedSearchMatch.lineNumber,
        lineEnd: selectedSearchMatch.lineNumber,
      };
    }
    return navigationHighlight;
  }, [navigationHighlight, search.matches, search.selected]);
  const expandContext = props.reviewPresentation?.onExpandContext;
  const searchStatusLabel = changesSearchStatusLabel(search);
  const lspHoverStyle = useMemo<React.CSSProperties | undefined>(
    () => (lspHover ? { ...HOVER_STYLE, left: lspHover.left, top: lspHover.top } : undefined),
    [lspHover],
  );
  const model = useMemo(() => {
    if (!loadedTypography || !measurement) {
      return emptyDiffDocumentModel({
        layout: props.displayPreferences.layout,
        wrapLines: props.displayPreferences.wrapLines,
        viewportWidth: viewport.width,
        lineHeight: desiredTypography.lineHeight,
      });
    }
    const dependencies = [
      props.files,
      props.displayPreferences.layout,
      props.displayPreferences.wrapLines,
      viewport.width,
      loadedTypography,
      measurement,
      props.palette,
      t,
    ] as const;
    const previous = reusableModelRef.current;
    const canReuse = previous?.dependencies.every(
      (dependency, index) => dependency === dependencies[index],
    );
    const reuseFrom = canReuse ? previous?.models : undefined;
    const next = buildDiffDocumentModel({
      files: props.files,
      collapsedFilePaths: props.collapsedFilePaths,
      layout: props.displayPreferences.layout,
      wrapLines: props.displayPreferences.wrapLines,
      viewportWidth: viewport.width,
      typography: loadedTypography,
      measureText: measurement,
      palette: props.palette,
      reviewActions,
      labels: {
        binary: t("workspace.git.diff.binaryFile"),
        tooLarge: t("workspace.git.diff.tooLarge"),
      },
      reuseFrom,
    });
    reusableModelRef.current = {
      dependencies,
      models: retainReusableModels(reuseFrom, next),
    };
    return next;
  }, [
    measurement,
    props.collapsedFilePaths,
    props.displayPreferences.layout,
    props.displayPreferences.wrapLines,
    props.files,
    props.palette,
    reviewActions,
    t,
    desiredTypography.lineHeight,
    loadedTypography,
    viewport.width,
  ]);
  modelRef.current = model;
  const requestedColumnOffset = useMemo(
    () => navigationColumnOffset(model, workingMode),
    [model, workingMode],
  );

  const paint = useCallback(() => {
    frameRef.current = null;
    const canvas = canvasRef.current;
    const currentModel = modelRef.current;
    if (!canvas || !currentModel || currentModel.viewportWidth <= 0 || viewport.height <= 0) return;
    const desiredHeight = Math.min(
      Math.max(currentModel.height, viewport.height),
      viewport.height * 3,
    );
    const currentWindow = canvasWindowRef.current;
    const viewportTop = scrollTopRef.current;
    const viewportBottom = viewportTop + viewport.height;
    const safeInset = viewport.height / 2;
    const mustRecenter =
      currentWindow.height !== desiredHeight ||
      viewportTop < currentWindow.top + safeInset ||
      viewportBottom > currentWindow.top + currentWindow.height - safeInset;
    if (!forcePaintRef.current && !mustRecenter) return;
    const forceFullPaint = forcePaintRef.current;
    forcePaintRef.current = false;
    const canvasHeight = desiredHeight;
    const ratio = window.devicePixelRatio || 1;
    const requestedCanvasTop = mustRecenter
      ? Math.min(
          Math.max(0, viewportTop - viewport.height),
          Math.max(0, currentModel.height - canvasHeight),
        )
      : currentWindow.top;
    const canvasTop = Math.round(requestedCanvasTop * ratio) / ratio;
    canvasWindowRef.current = { top: canvasTop, height: canvasHeight };
    const pixelWidth = Math.ceil(currentModel.viewportWidth * ratio);
    const pixelHeight = Math.ceil(canvasHeight * ratio);
    const resized = canvas.width !== pixelWidth || canvas.height !== pixelHeight;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.top = `${canvasTop}px`;
    canvas.style.height = `${canvasHeight}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (!measurement || !loadedTypography) return;
    const { paintTop, paintHeight } = shiftCanvasPixels({
      canvas,
      scratch:
        canvasScratchRef.current ?? (canvasScratchRef.current = document.createElement("canvas")),
      context,
      currentTop: currentWindow.top,
      nextTop: canvasTop,
      canvasHeight,
      pixelWidth,
      pixelHeight,
      ratio,
      canReuse: !forceFullPaint && !resized && currentWindow.height === canvasHeight,
    });
    paintWebViewport({
      context,
      model: currentModel,
      palette: props.palette,
      typography: loadedTypography,
      measureText: measurement,
      scrollTop: canvasTop,
      viewportWidth: currentModel.viewportWidth,
      viewportHeight: canvasHeight,
      horizontalOffsets: horizontalOffsetsRef.current,
      selection: selectionRef.current,
      navigationHighlight: effectiveNavigationHighlight,
      devicePixelRatio: ratio,
      paintTop,
      paintHeight,
    });
  }, [effectiveNavigationHighlight, loadedTypography, measurement, props.palette, viewport.height]);
  const schedulePaint = useCallback(
    (force = true) => {
      if (force) forcePaintRef.current = true;
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(paint);
    },
    [paint],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const commitPendingViewport = () =>
      setViewport((current) => retainDiffViewport(current, pendingViewportRef.current));
    const clearResizeSettleTimer = () => {
      if (resizeSettleTimerRef.current === null) return;
      clearTimeout(resizeSettleTimerRef.current);
      resizeSettleTimerRef.current = null;
    };
    const handlePointerDown = () => {
      resizePointerActiveRef.current = true;
      clearResizeSettleTimer();
    };
    const handlePointerEnd = () => {
      if (!resizePointerActiveRef.current) return;
      resizePointerActiveRef.current = false;
      if (resizeReleaseFrameRef.current !== null) {
        cancelAnimationFrame(resizeReleaseFrameRef.current);
      }
      resizeReleaseFrameRef.current = requestAnimationFrame(() => {
        resizeReleaseFrameRef.current = null;
        commitPendingViewport();
      });
    };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextViewport = { width: entry.contentRect.width, height: entry.contentRect.height };
      pendingViewportRef.current = nextViewport;
      if (resizePointerActiveRef.current) return;
      setViewport((currentViewport) =>
        currentViewport.width > 0 && currentViewport.height > 0
          ? currentViewport
          : retainDiffViewport(currentViewport, nextViewport),
      );
      clearResizeSettleTimer();
      resizeSettleTimerRef.current = setTimeout(() => {
        resizeSettleTimerRef.current = null;
        commitPendingViewport();
      }, RESIZE_SETTLE_DELAY_MS);
    });
    observer.observe(root);
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("pointerup", handlePointerEnd, { capture: true });
    window.addEventListener("pointercancel", handlePointerEnd, { capture: true });
    return () => {
      observer.disconnect();
      clearResizeSettleTimer();
      if (resizeReleaseFrameRef.current !== null)
        cancelAnimationFrame(resizeReleaseFrameRef.current);
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointerup", handlePointerEnd, { capture: true });
      window.removeEventListener("pointercancel", handlePointerEnd, { capture: true });
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([
        document.fonts.load(`400 ${desiredTypography.size}px ${desiredTypography.family}`),
        document.fonts.load(`600 ${desiredTypography.size}px ${desiredTypography.family}`),
      ]);
      await document.fonts.ready;
      if (!cancelled) setLoadedTypography(desiredTypography);
    })();
    return () => {
      cancelled = true;
    };
  }, [desiredTypography]);
  useLayoutEffect(() => {
    const previous = previousModelRef.current;
    const scroll = scrollRef.current;
    if (previous && scroll && previous !== model) {
      const nextScrollTop = resolveRelayoutScrollTop(previous, model, scroll.scrollTop);
      scrollTopRef.current = nextScrollTop;
      scroll.scrollTop = nextScrollTop;
    }
    previousModelRef.current = model;
  }, [model]);
  useLayoutEffect(() => {
    horizontalOffsetsRef.current = retainHorizontalOffsetMapForPaths(
      horizontalOffsetsRef.current,
      props.files.map((file) => file.path),
    );
  }, [props.files]);
  useLayoutEffect(schedulePaint, [model, schedulePaint]);
  useLayoutEffect(schedulePaint, [effectiveNavigationHighlight, schedulePaint]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Fast Refresh preserves refs while rerunning effects. Release ownership of the canceled
      // request so the refreshed renderer can schedule its first paint.
      frameRef.current = null;
    },
    [],
  );
  const mode = props.mode;
  const collapsedFilePaths = props.collapsedFilePaths;
  useEffect(() => {
    if (mode.kind !== "working" || mode.focusLineStart) return;
    const focusPath = mode.focusPath;
    if (!focusPath) return;
    const requestKey = `${mode.focusRequestId ?? "initial"}:${focusPath}`;
    if (consumedFocusRef.current === requestKey) return;
    if (collapsedFilePaths.has(focusPath)) {
      onToggleFile(focusPath);
      return;
    }
    const file = model.files.find((entry) => entry.path === focusPath);
    const scroll = scrollRef.current;
    if (file && scroll) {
      scroll.scrollTop = file.top;
      scroll.focus({ preventScroll: true });
      consumedFocusRef.current = requestKey;
    }
  }, [collapsedFilePaths, mode, model.files, onToggleFile]);
  useEffect(() => {
    if (mode.kind !== "working" || !mode.focusPath || !mode.focusLineStart) return;
    const requestKey = `${mode.focusRequestId ?? "initial"}:${mode.focusPath}:${mode.focusLineStart}:${mode.focusLineEnd ?? mode.focusLineStart}`;
    if (consumedFocusRef.current === requestKey) return;
    if (collapsedFilePaths.has(mode.focusPath)) {
      onToggleFile(mode.focusPath);
      return;
    }
    const row = model.rows.find(
      (candidate) =>
        candidate.kind === "line" &&
        candidate.path === mode.focusPath &&
        candidate.cells.some(
          (cell) =>
            cell?.lineNumber !== null &&
            cell?.lineNumber !== undefined &&
            cell.lineNumber >= mode.focusLineStart! &&
            cell.lineNumber <= (mode.focusLineEnd ?? mode.focusLineStart!),
        ),
    );
    const scroll = scrollRef.current;
    if (row?.kind === "line" && scroll) {
      scroll.scrollTop = Math.max(0, row.top - FILE_HEADER_HEIGHT);
      scroll.focus({ preventScroll: true });
      consumedFocusRef.current = requestKey;
    }
  }, [collapsedFilePaths, mode, model, onToggleFile]);
  useEffect(() => {
    const presentation = props.reviewPresentation;
    const selectedLineId = presentation?.selectedLineId;
    if (!selectedLineId || !workingMode?.fileReviews) return;
    const requestKey = `${presentation.focusRequest}:${selectedLineId}`;
    if (consumedReviewFocusRef.current === requestKey) return;
    const row = model.rows.find(
      (candidate) =>
        candidate.kind === "line" &&
        candidate.cells.some((cell) => {
          const targetKey = cell?.reviewTarget?.key;
          return (
            targetKey !== undefined &&
            workingMode.fileReviews?.lineByTargetKey.get(targetKey)?.id === selectedLineId
          );
        }),
    );
    const scroll = scrollRef.current;
    if (row?.kind !== "line" || !scroll) return;
    scroll.scrollTop = Math.max(0, row.top - (viewport.height - row.height) / 2);
    scroll.focus({ preventScroll: true });
    consumedReviewFocusRef.current = requestKey;
  }, [model, props.reviewPresentation, viewport.height, workingMode]);

  const handleVerticalScroll = useCallback(
    (scrollElement: HTMLDivElement) => {
      const scrollTop = scrollElement.scrollTop;
      scrollTopRef.current = scrollTop;
      const currentModel = modelRef.current;
      const currentWindow = canvasWindowRef.current;
      if (!currentModel || currentWindow.height === 0) {
        schedulePaint(false);
        return;
      }
      const viewportBottom = scrollTop + viewport.height;
      const safeInset = viewport.height / 2;
      const crossedSafeInset =
        scrollTop < currentWindow.top + safeInset ||
        viewportBottom > currentWindow.top + currentWindow.height - safeInset;
      if (!crossedSafeInset) return;
      const requestedTop = Math.min(
        Math.max(0, scrollTop - viewport.height),
        Math.max(0, currentModel.height - currentWindow.height),
      );
      const ratio = window.devicePixelRatio || 1;
      const nextTop = Math.round(requestedTop * ratio) / ratio;
      if (nextTop !== currentWindow.top) schedulePaint(false);
    },
    [schedulePaint, viewport.height],
  );
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onScroll = () => handleVerticalScroll(scroll);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [handleVerticalScroll]);
  const handleHorizontalScroll = useCallback(
    (path: string, offset: number) => {
      horizontalOffsetsRef.current.set(path, offset);
      schedulePaint();
    },
    [schedulePaint],
  );
  const pointHit = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const currentModel = modelRef.current;
    const root = rootRef.current;
    if (!currentModel || !root) return null;
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const documentY = event.clientY - bounds.top + scrollTopRef.current;
    const file = currentModel.files.find(
      (entry) => entry.top <= documentY && documentY < entry.bottom,
    );
    return hitTestDiffDocument({
      model: currentModel,
      x,
      documentY,
      horizontalOffset: file ? (horizontalOffsetsRef.current.get(file.path) ?? 0) : 0,
    });
  }, []);
  const lspTargetAt = useCallback(
    (event: MouseEvent) => {
      const hit = pointHit(event as unknown as React.PointerEvent<HTMLDivElement>);
      if (hit?.kind !== "cell") return null;
      const currentModel = modelRef.current;
      const row = currentModel?.rows[hit.position.rowIndex];
      const cell = row?.kind === "line" ? row.cells[hit.position.cellIndex] : null;
      // Source offsets are from the measured UTF-16 cell content, not any gutter or canvas chrome.
      if (!cell || cell.sourceIdentity.side !== "new" || cell.lineNumber === null) return null;
      return {
        filePath: currentModel?.files[hit.position.fileIndex]?.path,
        lineNumber: cell.lineNumber,
        column: hit.position.sourceOffset + 1,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    },
    [pointHit],
  );
  const centerSearchMatch = useCallback(
    async (match: ChangesSearchMatch) => {
      await workingMode?.onRevealSearchMatch?.(match);
      const file = modelRef.current?.files.find((entry) => entry.path === match.filePath);
      if (file?.isCollapsed) onToggleFile(match.filePath);
      let attempts = 30;
      const center = () => {
        const current = modelRef.current;
        const scroll = scrollRef.current;
        if (!current || !scroll) return;
        if (match.kind === "file") {
          scroll.scrollTop = Math.max(
            0,
            current.files.find((entry) => entry.path === match.filePath)?.top ?? 0,
          );
          scroll.focus({ preventScroll: true });
          return;
        }
        const row = current.rows.find(
          (candidate) =>
            candidate.kind === "line" &&
            candidate.path === match.filePath &&
            candidate.cells.some(
              (cell) => cell?.sourceIdentity.side === "new" && cell.lineNumber === match.lineNumber,
            ),
        );
        if (row) {
          scroll.scrollTop = Math.max(0, row.top - viewport.height / 2 + row.height / 2);
          scroll.focus({ preventScroll: true });
        } else if (attempts-- > 0) requestAnimationFrame(center);
      };
      requestAnimationFrame(center);
    },
    [onToggleFile, viewport.height, workingMode],
  );
  const selectSearchMatch = useCallback(
    (index: number) => {
      setSearch((current) => {
        if (current.matches.length === 0) return current;
        const selected = (index + current.matches.length) % current.matches.length;
        const match = current.matches[selected];
        if (match) void centerSearchMatch(match);
        return { ...current, selected };
      });
    },
    [centerSearchMatch],
  );
  const submitSearch = useCallback(async () => {
    const query = search.query.trim();
    if (!query) return;
    if (!workingMode?.searchSupported || !workingMode.onSearch) {
      setSearch((current) => ({
        ...current,
        status: "error",
        error: "Update this host to search Changes.",
      }));
      return;
    }
    setSearch((current) => ({ ...current, status: "loading", error: null }));
    searchInputRef.current?.blur();
    try {
      const result = await workingMode.onSearch(query);
      setSearch((current) => ({
        ...current,
        matches: result.matches,
        selected: result.matches.length > 0 ? 0 : -1,
        status: "ready",
        truncated: result.truncated,
      }));
      if (result.matches[0]) void centerSearchMatch(result.matches[0]);
    } catch (error) {
      setSearch((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Changes search failed.",
      }));
    }
  }, [centerSearchMatch, search.query, workingMode]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || props.mode.kind !== "working") return;
    const owns = (event: KeyboardEvent) =>
      root.contains(event.target as Node | null) || root.contains(document.activeElement);
    const keydown = (event: KeyboardEvent) => {
      if (!owns(event) || event.isComposing || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const editing =
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable='true']");
      if (!search.open) {
        if (event.key !== "/" || editing) return;
        event.preventDefault();
        setSearch({
          open: true,
          query: "",
          matches: [],
          selected: -1,
          status: "idle",
          truncated: false,
          error: null,
        });
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSearch((current) => ({ ...current, open: false }));
        root
          .querySelector<HTMLElement>("[data-testid='git-diff-scroll']")
          ?.focus({ preventScroll: true });
      } else if (!editing && event.key === "n") {
        event.preventDefault();
        selectSearchMatch(search.selected + 1);
      } else if (!editing && event.key === "N") {
        event.preventDefault();
        selectSearchMatch(search.selected - 1);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [props.mode.kind, search.open, search.selected, selectSearchMatch]);
  useEffect(() => {
    const root = rootRef.current;
    const lsp = workingMode?.lsp;
    if (!root || !lsp?.enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: ReturnType<typeof lspTargetAt> = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const move = (event: MouseEvent) => {
      const target = lspTargetAt(event);
      if (!target || !target.filePath) {
        clear();
        last = null;
        setLspHover(null);
        return;
      }
      if (
        last?.filePath === target.filePath &&
        last.lineNumber === target.lineNumber &&
        last.column === target.column
      )
        return;
      last = target;
      clear();
      timer = setTimeout(
        () =>
          void lsp.hover(target.filePath!, target.lineNumber, target.column).then((text) => {
            if (last === target && text) {
              const box = root.getBoundingClientRect();
              setLspHover({
                text,
                left: target.clientX - box.left + 12,
                top: target.clientY - box.top + 16,
              });
            }
            return undefined;
          }),
        350,
      );
    };
    const click = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return;
      const target = lspTargetAt(event);
      if (!target?.filePath) return;
      event.preventDefault();
      void lsp.definition(target.filePath, target.lineNumber, target.column);
    };
    const context = (event: MouseEvent) => {
      const target = lspTargetAt(event);
      const show = window.paseoDesktop?.menu?.showContextMenu;
      if (!target?.filePath || typeof show !== "function") return;
      event.preventDefault();
      void show({ kind: "editor-lsp" }).then((action) => {
        if (action === "go-to-definition") {
          return lsp.definition(target.filePath!, target.lineNumber, target.column);
        }
        return undefined;
      });
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "F12" && last?.filePath && root.contains(document.activeElement)) {
        event.preventDefault();
        void lsp.definition(last.filePath, last.lineNumber, last.column);
      }
    };
    root.addEventListener("mousemove", move);
    root.addEventListener("click", click);
    root.addEventListener("contextmenu", context);
    root.addEventListener("mouseleave", () => setLspHover(null));
    window.addEventListener("keydown", keys);
    return () => {
      clear();
      root.removeEventListener("mousemove", move);
      root.removeEventListener("click", click);
      root.removeEventListener("contextmenu", context);
      window.removeEventListener("keydown", keys);
      setLspHover(null);
    };
  }, [lspTargetAt, workingMode?.lsp]);
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '[data-diff-header="true"], [data-diff-review="true"], [role="menuitem"], button, input, textarea',
        )
      )
        return;
      const dismissSelectionOnClick = selectionRef.current !== null;
      if (dismissSelectionOnClick) {
        selectionRef.current = null;
        schedulePaint();
      }
      const hit = pointHit(event);
      if (hit?.kind !== "cell") return;
      const line = hit.target
        ? workingMode?.fileReviews?.lineByTargetKey.get(hit.target.key)
        : undefined;
      if (line) props.reviewPresentation?.onSelectLine(line);
      dragRef.current = {
        anchor: hit.position,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        dismissSelectionOnClick,
      };
      selectionRef.current = { anchor: hit.position, focus: hit.position };
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      schedulePaint();
    },
    [pointHit, props.reviewPresentation, schedulePaint, workingMode?.fileReviews],
  );
  const pointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag) {
        drag.moved = hasPointerDragStarted({
          startX: drag.startX,
          startY: drag.startY,
          x: event.clientX,
          y: event.clientY,
          alreadyDragging: drag.moved,
        });
      }
      const hit = pointHit(event);
      if (!drag || hit?.kind !== "cell") return;
      selectionRef.current = { anchor: drag.anchor, focus: hit.position };
      schedulePaint();
    },
    [pointHit, schedulePaint],
  );
  const pointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const hit = pointHit(event);
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const moved = drag
        ? hasPointerDragStarted({
            startX: drag.startX,
            startY: drag.startY,
            x: event.clientX,
            y: event.clientY,
            alreadyDragging: drag.moved,
          })
        : false;
      if (drag && !moved && drag.dismissSelectionOnClick) {
        selectionRef.current = null;
        schedulePaint();
        return;
      }
      if (
        event.pointerType === "touch" &&
        drag &&
        !moved &&
        hit?.kind === "cell" &&
        hit.target &&
        reviewActions
      ) {
        selectionRef.current = null;
        reviewActions.onStartComment(hit.target);
        schedulePaint();
      }
    },
    [pointHit, reviewActions, schedulePaint],
  );
  const cancelPointer = useCallback(() => {
    dragRef.current = null;
  }, []);
  const copy = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!selectionRef.current) return;
      event.clipboardData.setData("text/plain", selectedSourceText(model, selectionRef.current));
      event.preventDefault();
    },
    [model],
  );
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch((current) => ({
      ...current,
      query: event.target.value,
      status: "idle",
      error: null,
    }));
  }, []);
  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void submitSearch();
    },
    [submitSearch],
  );
  const focusDocument = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);
  const rootStyle = useMemo<React.CSSProperties>(
    () => ({ ...ROOT_STYLE, background: props.palette.surface }),
    [props.palette.surface],
  );
  const contentStyle = useMemo<React.CSSProperties>(
    () => ({ ...CONTENT_STYLE, height: Math.max(model.height, viewport.height) }),
    [model.height, viewport.height],
  );
  const canvasStyle = useMemo<React.CSSProperties>(
    () => ({
      ...CANVAS_STYLE,
      width: model.viewportWidth,
      fontFamily: (loadedTypography ?? desiredTypography).family,
      fontSize: (loadedTypography ?? desiredTypography).size,
    }),
    [desiredTypography, loadedTypography, model.viewportWidth],
  );

  return (
    <div
      data-testid="git-diff-canvas-root"
      data-paseito-diff-focus-path={workingMode?.focusPath}
      data-paseito-diff-focus-line-start={workingMode?.focusLineStart}
      data-paseito-diff-focus-line-end={workingMode?.focusLineEnd}
      data-paseito-diff-focus-column={workingMode?.focusColumn}
      ref={rootRef}
      style={rootStyle}
    >
      <div
        ref={scrollRef}
        data-testid="git-diff-scroll"
        data-overlay-scrollbar="true"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
        onCopy={copy}
        style={SCROLL_STYLE}
      >
        <div style={contentStyle} onMouseDown={preventDocumentMouseSelection}>
          <canvas ref={canvasRef} data-testid="git-diff-canvas" style={canvasStyle} />
          {model.files.map((file) => (
            <WebFileHeaderSection key={file.path} file={file}>
              <DocumentFileHeader
                file={file}
                selectedPath={props.selectedPath}
                mode={props.mode}
                onToggleFile={props.onToggleFile}
                onSelectPath={props.onSelectPath}
                onFocusDocument={focusDocument}
              />
            </WebFileHeaderSection>
          ))}
          {model.files
            .filter((file) => !file.isCollapsed && !model.wrapLines)
            .map((file) => (
              <HorizontalScroll
                key={file.path}
                file={file}
                initialOffset={
                  requestedColumnOffset?.path === file.path
                    ? requestedColumnOffset.offset
                    : (horizontalOffsetsRef.current.get(file.path) ?? 0)
                }
                requestKey={
                  requestedColumnOffset?.path === file.path
                    ? requestedColumnOffset.requestKey
                    : undefined
                }
                onScroll={handleHorizontalScroll}
              />
            ))}
          {props.mode.kind === "working" && reviewActions
            ? model.rows.map((row) => {
                if (row.kind !== "line") return null;
                const columnWidth = model.viewportWidth / row.cells.length;
                return row.cells.map((cell, index) => {
                  if (!cell?.reviewTarget) return null;
                  const thread = getInlineReviewThreadState({
                    reviewTarget: cell.reviewTarget,
                    reviewActions,
                  });
                  const file = model.files[row.fileIndex];
                  if (!file) return null;
                  const changed = workingMode?.fileReviews?.lineByTargetKey.get(
                    cell.reviewTarget.key,
                  );
                  return [
                    <WebCanvasRowMarker
                      key={`${cell.reviewTarget.key}:row-marker`}
                      targetKey={cell.reviewTarget.key}
                      sourceText={cell.content}
                      sourceX={index * columnWidth + file.gutterWidth + 8}
                      top={row.top}
                      height={row.height}
                    />,
                    <WebReviewGutter
                      key={`${cell.reviewTarget.key}:gutter`}
                      target={cell.reviewTarget}
                      actions={reviewActions}
                      top={row.top}
                      left={index * columnWidth}
                      width={file.gutterWidth}
                      height={model.lineHeight}
                      changedLine={changed}
                      reviewed={
                        changed
                          ? workingMode?.fileReviews?.reviewedLineIds.has(changed.id) === true
                          : false
                      }
                      selected={changed?.id === props.reviewPresentation?.selectedLineId}
                      onSelectLine={props.reviewPresentation?.onSelectLine}
                      onToggleLine={props.reviewPresentation?.onToggleLine}
                    />,
                    thread ? (
                      <WebReviewThread
                        key={cell.reviewTarget.key}
                        target={cell.reviewTarget}
                        actions={reviewActions}
                        top={row.top + row.height - row.reviewHeight}
                        left={index * columnWidth}
                        width={columnWidth}
                        height={row.reviewHeight}
                        pinToViewport={!model.wrapLines}
                      />
                    ) : null,
                  ];
                });
              })
            : null}
          {effectiveNavigationHighlight
            ? navigationMarkers(model, effectiveNavigationHighlight).map((marker) => (
                <div
                  key={marker.key}
                  data-paseito-diff-current-line={marker.lineNumber}
                  data-paseito-diff-file={marker.path}
                  data-paseito-diff-navigation-selected="true"
                  style={marker.style}
                />
              ))
            : null}
          {workingMode && expandContext
            ? model.rows.map((row) => {
                if (row.kind !== "line") return null;
                const marker = row.cells
                  .map((cell) => cell && parseDiffContextMarker(cell.content))
                  .find(Boolean);
                if (!marker) return null;
                const file = model.files[row.fileIndex];
                return file ? (
                  <WebContextControl
                    key={`${file.path}:${row.index}`}
                    filePath={file.path}
                    region={marker}
                    top={row.top}
                    height={row.height}
                    onExpand={expandContext}
                  />
                ) : null;
              })
            : null}
        </div>
      </div>
      <DomOverlayScrollbar scrollContainerRef={scrollRef} onUserScrollUp={noop} />
      {search.open ? (
        <div style={SEARCH_STYLE} data-testid="changes-search-bar">
          <span>/</span>
          <input
            ref={searchInputRef}
            value={search.query}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search changed files"
            data-testid="changes-search-input"
            style={SEARCH_INPUT_STYLE}
          />
          <span data-testid="changes-search-status">{searchStatusLabel}</span>
        </div>
      ) : null}
      {lspHover ? (
        <div style={lspHoverStyle} data-testid="changes-lsp-hover">
          {lspHover.text}
        </div>
      ) : null}
      {props.reviewPresentation?.shortcutHint ? (
        <div aria-live="polite" data-testid="line-review-shortcut-hint" style={SHORTCUT_HINT_STYLE}>
          {props.reviewPresentation.shortcutHint}
        </div>
      ) : null}
    </div>
  );
}

function shiftCanvasPixels(input: {
  canvas: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  currentTop: number;
  nextTop: number;
  canvasHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  ratio: number;
  canReuse: boolean;
}): { paintTop: number; paintHeight: number } {
  const delta = input.nextTop - input.currentTop;
  if (!input.canReuse || delta === 0 || Math.abs(delta) >= input.canvasHeight) {
    return { paintTop: 0, paintHeight: input.canvasHeight };
  }
  const deltaPixels = Math.round(Math.abs(delta) * input.ratio);
  const overlapPixels = input.pixelHeight - deltaPixels;
  if (input.scratch.width !== input.pixelWidth) input.scratch.width = input.pixelWidth;
  if (input.scratch.height !== input.pixelHeight) input.scratch.height = input.pixelHeight;
  const scratchContext = input.scratch.getContext("2d");
  if (!scratchContext) return { paintTop: 0, paintHeight: input.canvasHeight };
  scratchContext.setTransform(1, 0, 0, 1, 0, 0);
  scratchContext.globalCompositeOperation = "copy";
  scratchContext.drawImage(input.canvas, 0, 0);
  input.context.setTransform(1, 0, 0, 1, 0, 0);
  if (delta > 0) {
    input.context.drawImage(
      input.scratch,
      0,
      deltaPixels,
      input.pixelWidth,
      overlapPixels,
      0,
      0,
      input.pixelWidth,
      overlapPixels,
    );
    return { paintTop: input.canvasHeight - Math.abs(delta), paintHeight: Math.abs(delta) };
  }
  input.context.drawImage(
    input.scratch,
    0,
    0,
    input.pixelWidth,
    overlapPixels,
    0,
    deltaPixels,
    input.pixelWidth,
    overlapPixels,
  );
  return { paintTop: 0, paintHeight: Math.abs(delta) };
}

function WebFileHeaderSection({
  file,
  children,
}: {
  file: ReturnType<typeof buildDiffDocumentModel>["files"][number];
  children: React.ReactNode;
}) {
  const style = useMemo<React.CSSProperties>(
    () => ({ ...FILE_SECTION_STYLE, top: file.top, height: file.bottom - file.top }),
    [file.bottom, file.top],
  );
  return (
    <div style={style}>
      <div
        data-diff-header="true"
        style={STICKY_HEADER_STYLE}
        onMouseDown={preventDocumentMouseSelection}
      >
        {children}
      </div>
      <div data-testid={`diff-file-${file.fileIndex}-body`} style={BODY_MARKER_STYLE} />
    </div>
  );
}

function preventDocumentMouseSelection(event: React.MouseEvent): void {
  if (event.detail < 2) return;
  const target = event.target;
  if (target instanceof Element && target.closest('[data-diff-review="true"]')) return;
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
}

function WebReviewGutter({
  target,
  actions,
  top,
  left,
  width,
  height,
  changedLine,
  reviewed,
  selected,
  onSelectLine,
  onToggleLine,
}: {
  target: ReviewableDiffTarget;
  actions: NonNullable<Extract<DiffSurfaceProps["mode"], { kind: "working" }>["reviewActions"]>;
  top: number;
  left: number;
  width: number;
  height: number;
  changedLine: import("@/review").ReviewableChangedLine | undefined;
  reviewed: boolean;
  selected: boolean;
  onSelectLine?: (line: import("@/review").ReviewableChangedLine) => void;
  onToggleLine?: (line: import("@/review").ReviewableChangedLine) => void;
}) {
  const style = useMemo<ViewStyle>(
    () => ({ position: "absolute", top, left, width, height, zIndex: 5 }),
    [height, left, top, width],
  );
  const accessibilityState = useMemo(() => ({ checked: reviewed }), [reviewed]);
  const toggleReviewed = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      if (!changedLine || !onToggleLine) return;
      onSelectLine?.(changedLine);
      onToggleLine(changedLine);
    },
    [changedLine, onSelectLine, onToggleLine],
  );
  const comments = actions.commentsByTarget.get(target.key) ?? [];
  return (
    <InlineReviewGutterCell
      reviewTarget={target}
      comments={comments}
      isEditorOpen={
        getInlineReviewThreadState({ reviewTarget: target, reviewActions: actions }) !== null
      }
      lineHeight={height}
      onStartComment={actions.onStartComment}
      reviewActions={actions}
      style={style}
      actionTestID={`diff-review-gutter-action-${target.key}`}
      testID={`diff-review-gutter-${target.key}`}
    >
      <div
        data-paseito-review-selected={selected ? "true" : undefined}
        data-paseito-review-target-key={target.key}
        data-testid={selected ? `diff-review-focus-${target.key}` : undefined}
        style={selected ? WEB_SELECTED_LINE_STYLE : undefined}
      >
        {changedLine && onToggleLine ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={accessibilityState}
            accessibilityLabel={reviewed ? "Mark line unreviewed" : "Mark line reviewed"}
            onPress={toggleReviewed}
            style={WEB_LINE_REVIEW_STYLE}
            testID={`diff-line-review-${target.key}`}
          >
            <Text style={WEB_LINE_REVIEW_TEXT}>{reviewed ? "✓" : "○"}</Text>
          </Pressable>
        ) : null}
      </div>
    </InlineReviewGutterCell>
  );
}

function WebCanvasRowMarker({
  targetKey,
  sourceText,
  sourceX,
  top,
  height,
}: {
  targetKey: string;
  sourceText: string;
  sourceX: number;
  top: number;
  height: number;
}) {
  const style = useMemo<React.CSSProperties>(
    () => ({ position: "absolute", top, left: 0, width: 1, height, pointerEvents: "none" }),
    [height, top],
  );
  return (
    <div
      data-testid={`diff-canvas-row-${targetKey}`}
      data-paseito-diff-canvas-source-text={sourceText}
      data-paseito-diff-canvas-source-x={sourceX}
      style={style}
    />
  );
}

function WebContextControl({
  filePath,
  region,
  top,
  height,
  onExpand,
}: {
  filePath: string;
  region: DiffContextRegion;
  top: number;
  height: number;
  onExpand: NonNullable<Extract<DiffSurfaceProps["mode"], { kind: "working" }>["onExpandContext"]>;
}) {
  const style = useMemo<React.CSSProperties>(
    () => ({
      position: "absolute",
      top,
      left: 22,
      height,
      zIndex: 7,
      display: "flex",
      alignItems: "center",
      gap: 8,
    }),
    [height, top],
  );
  const expandUp = useCallback(
    () => void onExpand(filePath, region, "up"),
    [filePath, onExpand, region],
  );
  const expandDown = useCallback(
    () => void onExpand(filePath, region, "down"),
    [filePath, onExpand, region],
  );
  const expandAll = useCallback(
    () => void onExpand(filePath, region, "all"),
    [filePath, onExpand, region],
  );
  return (
    <div style={style} data-diff-review="true" data-testid="diff-context-control">
      <button type="button" onClick={expandUp}>
        ↑ 20
      </button>
      <button type="button" onClick={expandDown}>
        ↓ 20
      </button>
      <button type="button" onClick={expandAll}>
        Expand {Math.min(region.lineCount, 5000)}
      </button>
    </div>
  );
}

function WebReviewThread({
  target,
  actions,
  top,
  left,
  width,
  height,
  pinToViewport,
}: {
  target: ReviewableDiffTarget;
  actions: NonNullable<Extract<DiffSurfaceProps["mode"], { kind: "working" }>["reviewActions"]>;
  top: number;
  left: number;
  width: number;
  height: number;
  pinToViewport: boolean;
}) {
  const style = useMemo<React.CSSProperties>(
    () => ({ ...REVIEW_STYLE, top, left, width, height }),
    [height, left, top, width],
  );
  return (
    <div style={style} data-diff-review="true">
      <InlineReviewThread
        reviewTarget={target}
        reviewActions={actions}
        height={height}
        viewportWidth={width}
        pinToViewport={pinToViewport}
      />
    </div>
  );
}

const ROOT_STYLE: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};
const SCROLL_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarWidth: "none",
  cursor: "text",
};

function noop(): void {}
const CONTENT_STYLE: React.CSSProperties = {
  position: "relative",
  width: "100%",
  userSelect: "none",
};
const FILE_SECTION_STYLE: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  zIndex: 10,
  pointerEvents: "none",
};
const STICKY_HEADER_STYLE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  pointerEvents: "auto",
  userSelect: "none",
};
const BODY_MARKER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: FILE_HEADER_HEIGHT,
  bottom: 0,
  left: 0,
  right: 0,
  pointerEvents: "none",
};
const REVIEW_STYLE: React.CSSProperties = { position: "absolute", zIndex: 4, userSelect: "text" };
const SEARCH_STYLE: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  left: 12,
  top: 10,
  display: "flex",
  alignItems: "center",
  gap: 8,
  maxWidth: "calc(100% - 24px)",
  padding: "6px 8px",
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 6,
  background: "rgba(20,20,24,.96)",
  color: "#ddd",
  fontSize: 12,
};
const SEARCH_INPUT_STYLE: React.CSSProperties = {
  minWidth: 220,
  maxWidth: 420,
  border: 0,
  outline: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
};
const HOVER_STYLE: React.CSSProperties = {
  position: "absolute",
  zIndex: 30,
  maxWidth: 560,
  whiteSpace: "pre-wrap",
  pointerEvents: "none",
  padding: 8,
  borderRadius: 6,
  background: "rgba(20,20,24,.96)",
  color: "#eee",
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
};
const SHORTCUT_HINT_STYLE: React.CSSProperties = {
  position: "absolute",
  zIndex: 30,
  right: 12,
  bottom: 12,
  maxWidth: "calc(100% - 24px)",
  padding: "6px 8px",
  borderRadius: 6,
  background: "rgba(20,20,24,.9)",
  color: "#ddd",
  fontSize: 12,
  pointerEvents: "none",
};
const WEB_LINE_REVIEW_STYLE: ViewStyle = {
  width: 22,
  height: 22,
  alignItems: "center",
  justifyContent: "center",
};
const WEB_LINE_REVIEW_TEXT = { color: "#0a84ff", fontSize: 13 };
const WEB_SELECTED_LINE_STYLE: React.CSSProperties = {
  borderLeftWidth: 2,
  borderLeftStyle: "solid",
  borderLeftColor: "#0a84ff",
};
const CANVAS_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  zIndex: 1,
  pointerEvents: "none",
};
function emptyDiffDocumentModel(input: {
  layout: "unified" | "split";
  wrapLines: boolean;
  viewportWidth: number;
  lineHeight: number;
}): ReturnType<typeof buildDiffDocumentModel> {
  return {
    files: [],
    rows: [],
    height: 0,
    lineHeight: input.lineHeight,
    layout: input.layout,
    wrapLines: input.wrapLines,
    viewportWidth: input.viewportWidth,
  };
}

function createWebTextMeasurer(typography: DiffTypography): TextMeasurer {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return { measure: () => 0 };
  const measure = (text: string, weight: "regular" | "semibold" = "regular") => {
    context.font = `${weight === "semibold" ? 600 : 400} ${typography.size}px ${typography.family}`;
    return context.measureText(text).width;
  };
  // Canvas exposes no glyph coverage, so `requiresShaping` alone decides which
  // runs a shaper has to see -- there is no `glyphIds` to fall back on.
  return { measure, measureAdvances: createMeasuredAdvances((text) => measure(text)) };
}
