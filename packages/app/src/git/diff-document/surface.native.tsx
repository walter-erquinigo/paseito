import { Canvas, Group, Picture, type SkPicture } from "@shopify/react-native-skia";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollView,
  Text,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import Animated, {
  createAnimatedComponent,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { getInlineReviewThreadState, InlineReviewThread } from "@/review";
import { useKeyboardShift } from "@/hooks/keyboard-shift-context";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { DocumentFileHeader } from "./document-file-header";
import { parseDiffContextMarker } from "@/git/diff-context-expansion";
import { DiffContextControl } from "./context-control";
import {
  LINE_REVIEW_DOT_GUTTER_WIDTH,
  lineReviewDotGutterWidth,
  ReviewCheckbox,
} from "./review-checkbox";
import { hitTestDiffBodyPoint } from "./native-hit-testing";
import { retainDiffViewport } from "./viewport";
import { HorizontalScroll } from "./horizontal-scroll.native";
import {
  horizontalOffsetForPath,
  retainHorizontalOffsetsForPaths,
  type DiffHorizontalOffsets,
} from "./horizontal-offsets";
import {
  buildDiffDocumentModel,
  FILE_HEADER_HEIGHT,
  resolveRelayoutScrollTop,
  retainReusableModels,
  shouldApplyRelayoutScroll,
} from "./model";
import {
  buildNativeCanvasSlabs,
  nativeCanvasSlabsForViewport,
  nativeCanvasWindowBucket,
  nativeCanvasWindowTop,
  nativeStickyHeaderIndices,
  type NativeCanvasSlab,
} from "./native-slabs";
import { createNativePaints, recordNativeSlabPictures, type NativePaints } from "./paint.native";
import {
  createNativeTextLayoutStore,
  createNativeTextMeasurer,
  disposeNativeTextLayout,
  prepareNativeTextLayout,
  type NativeTextLayout,
} from "./text.native";
import type {
  DiffDocumentModel,
  DiffFileSection,
  DiffSurfaceProps,
  DiffTypography,
  TextMeasurer,
} from "./types";

const AnimatedScrollView = createAnimatedComponent(ScrollView);
const SYSTEM_MONO = "monospace";
const CODE_LEFT_PADDING = 8;

export function DiffSurface(props: DiffSurfaceProps) {
  const { t } = useTranslation();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<ScrollView>(null);
  const previousModelRef = useRef<ReturnType<typeof buildDiffDocumentModel> | null>(null);
  const reusableModelRef = useRef<{
    dependencies: readonly unknown[];
    models: ReturnType<typeof buildDiffDocumentModel>[];
  } | null>(null);
  const consumedFocusRef = useRef<string | null>(null);
  const consumedReviewFocusRef = useRef<string | null>(null);
  const scrollTop = useSharedValue(0);
  const { shift: keyboardShift } = useKeyboardShift();
  const keyboardSpacerStyle = useAnimatedStyle(
    () => ({ height: keyboardShift.value }),
    [keyboardShift],
  );
  const horizontalOffsets = useSharedValue<DiffHorizontalOffsets>({});
  const family = props.displayPreferences.monoFontFamily.trim() || SYSTEM_MONO;
  const typography = useMemo<DiffTypography>(
    () => ({
      family,
      size: props.displayPreferences.codeFontSize,
      lineHeight: Math.round(props.displayPreferences.codeFontSize * 1.5),
    }),
    [family, props.displayPreferences.codeFontSize],
  );
  const measurement = useMemo<TextMeasurer>(
    () => createNativeTextMeasurer({ configuredFamily: family, fontSize: typography.size }),
    [family, typography.size],
  );
  const reviewActions = props.mode.kind === "working" ? props.mode.reviewActions : undefined;
  const reviewIndicatorWidth = lineReviewDotGutterWidth(props.reviewPresentation !== undefined);
  const model = useMemo(() => {
    const dependencies = [
      props.files,
      props.displayPreferences.layout,
      props.displayPreferences.wrapLines,
      viewport.width,
      typography,
      measurement,
      props.palette,
      reviewIndicatorWidth,
      t,
    ] as const;
    const previous = reusableModelRef.current;
    const canReuse = previous?.dependencies.every(
      (dependency, index) => dependency === dependencies[index],
    );
    const reuseFrom = canReuse ? previous?.models : undefined;
    const next = buildDiffDocumentModel({
      files: viewport.width > 0 ? props.files : [],
      collapsedFilePaths: props.collapsedFilePaths,
      layout: props.displayPreferences.layout,
      wrapLines: props.displayPreferences.wrapLines,
      viewportWidth: viewport.width,
      typography,
      measureText: measurement,
      palette: props.palette,
      reviewActions,
      reviewIndicatorWidth,
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
    reviewIndicatorWidth,
    t,
    typography,
    viewport.width,
  ]);
  const paints = useMemo(() => createNativePaints(props.palette), [props.palette]);
  const textLayoutStore = useMemo(
    () =>
      createNativeTextLayoutStore({
        configuredFamily: family,
        fontSize: typography.size,
        lineHeight: typography.lineHeight,
        palette: props.palette,
      }),
    [family, props.palette, typography.lineHeight, typography.size],
  );
  const textLayout = useMemo(
    () => prepareNativeTextLayout(textLayoutStore, model),
    [model, textLayoutStore],
  );
  useEffect(() => () => disposeNativeTextLayout(textLayoutStore), [textLayoutStore]);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollTop.value = event.contentOffset.y;
  });

  const layout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((current) => retainDiffViewport(current, { width, height }));
  }, []);
  useLayoutEffect(() => {
    const previous = previousModelRef.current;
    if (previous && previous !== model) {
      const nextScrollTop = resolveRelayoutScrollTop(previous, model, scrollTop.value);
      if (shouldApplyRelayoutScroll(scrollTop.value, nextScrollTop)) {
        scrollTop.value = nextScrollTop;
        scrollRef.current?.scrollTo({ y: nextScrollTop, animated: false });
      }
    }
    previousModelRef.current = model;
  }, [model, scrollTop]);
  useLayoutEffect(() => {
    horizontalOffsets.value = retainHorizontalOffsetsForPaths(
      horizontalOffsets.value,
      model.files.map((file) => file.path),
    );
  }, [horizontalOffsets, model.files]);

  const mode = props.mode;
  const collapsedFilePaths = props.collapsedFilePaths;
  const onToggleFile = props.onToggleFile;
  useEffect(() => {
    if (mode.kind !== "working" || mode.focusLineStart) return;
    const focusPath = mode.focusPath;
    if (!focusPath) return;
    const requestKey = `${mode.focusRequestId ?? "initial"}:${focusPath}`;
    if (consumedFocusRef.current === requestKey) return;
    if (collapsedFilePaths.has(focusPath)) onToggleFile(focusPath);
    const file = model.files.find((entry) => entry.path === focusPath);
    if (file) {
      scrollTop.value = file.top;
      scrollRef.current?.scrollTo({ y: file.top, animated: false });
      consumedFocusRef.current = requestKey;
    }
  }, [collapsedFilePaths, mode, model.files, onToggleFile, scrollTop]);
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
    if (row) {
      const offset = Math.max(0, row.top - FILE_HEADER_HEIGHT);
      scrollTop.value = offset;
      scrollRef.current?.scrollTo({ y: offset, animated: false });
      consumedFocusRef.current = requestKey;
    }
  }, [collapsedFilePaths, mode, model.rows, onToggleFile, scrollTop]);
  useEffect(() => {
    const presentation = props.reviewPresentation;
    const selectedLineId = presentation?.selectedLineId;
    if (!selectedLineId || mode.kind !== "working" || !mode.fileReviews) return;
    const requestKey = `${presentation.focusRequest}:${selectedLineId}`;
    if (consumedReviewFocusRef.current === requestKey) return;
    const row = model.rows.find(
      (candidate) =>
        candidate.kind === "line" &&
        candidate.cells.some((cell) => {
          const targetKey = cell?.reviewTarget?.key;
          return (
            targetKey !== undefined &&
            mode.fileReviews?.lineByTargetKey.get(targetKey)?.id === selectedLineId
          );
        }),
    );
    if (row?.kind !== "line") return;
    const offset = Math.max(0, row.top - (viewport.height - row.height) / 2);
    scrollTop.value = offset;
    scrollRef.current?.scrollTo({ y: offset, animated: false });
    consumedReviewFocusRef.current = requestKey;
  }, [mode, model.rows, props.reviewPresentation, scrollTop, viewport.height]);
  const contentStyle = useMemo(
    () => ({ minHeight: viewport.height, backgroundColor: "transparent" }),
    [viewport.height],
  );
  const stickyHeaderIndices = useMemo(
    () => nativeStickyHeaderIndices(model.files.length),
    [model.files.length],
  );
  return (
    <View style={[styles.root, { backgroundColor: props.palette.surface }]} onLayout={layout}>
      <AnimatedScrollView
        ref={scrollRef}
        style={[StyleSheet.absoluteFill, styles.scroll]}
        contentContainerStyle={contentStyle}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator
        stickyHeaderIndices={stickyHeaderIndices}
        testID="git-diff-scroll"
      >
        <NativeCanvasSlabLayer
          model={model}
          viewportHeight={viewport.height}
          scrollTop={scrollTop}
          textLayout={textLayout}
          paints={paints}
          horizontalOffsets={horizontalOffsets}
        />
        {model.files.flatMap((file) => [
          <NativeStickyFileHeader
            key={`${file.path}:header`}
            file={file}
            selectedPath={props.selectedPath}
            mode={props.mode}
            onToggleFile={props.onToggleFile}
            onSelectPath={props.onSelectPath}
          />,
          <NativeFileBody
            key={`${file.path}:body`}
            file={file}
            model={model}
            mode={props.mode}
            horizontalOffsets={horizontalOffsets}
            presentation={props.reviewPresentation}
          />,
        ])}
        <NativeReviewOverlays
          model={model}
          mode={props.mode}
          presentation={props.reviewPresentation}
        />
        <Animated.View pointerEvents="none" style={keyboardSpacerStyle} />
      </AnimatedScrollView>
      {props.reviewPresentation?.shortcutHint ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={styles.shortcutHint}
          testID="line-review-shortcut-hint"
        >
          <Text style={styles.shortcutHintText}>{props.reviewPresentation.shortcutHint}</Text>
        </View>
      ) : null}
    </View>
  );
}

function NativeCanvasSlabLayer({
  model,
  viewportHeight,
  scrollTop,
  textLayout,
  paints,
  horizontalOffsets,
}: {
  model: DiffDocumentModel;
  viewportHeight: number;
  scrollTop: SharedValue<number>;
  textLayout: NativeTextLayout;
  paints: NativePaints;
  horizontalOffsets: SharedValue<DiffHorizontalOffsets>;
}) {
  const [windowTop, setWindowTop] = useState(0);
  const updateWindow = useCallback((nextTop: number) => {
    setWindowTop((current) => (current === nextTop ? current : nextTop));
  }, []);
  useAnimatedReaction(
    () => nativeCanvasWindowBucket(scrollTop.value, viewportHeight),
    (bucket, previous) => {
      if (bucket !== previous) {
        scheduleOnRN(updateWindow, nativeCanvasWindowTop(bucket, viewportHeight));
      }
    },
    [updateWindow, viewportHeight],
  );
  const descriptors = useMemo(
    () => buildNativeCanvasSlabs(model, viewportHeight),
    [model, viewportHeight],
  );
  const visible = useMemo(
    () => nativeCanvasSlabsForViewport(descriptors, windowTop, viewportHeight),
    [descriptors, viewportHeight, windowTop],
  );
  if (model.viewportWidth <= 0 || viewportHeight <= 0) return null;
  return visible.map((slab) => (
    <NativeCanvasSlabView
      key={slab.key}
      slab={slab}
      model={model}
      textLayout={textLayout}
      paints={paints}
      horizontalOffsets={horizontalOffsets}
    />
  ));
}

function NativeStickyFileHeader({
  file,
  selectedPath,
  mode,
  onToggleFile,
  onSelectPath,
}: {
  file: DiffFileSection;
  selectedPath: DiffSurfaceProps["selectedPath"];
  mode: DiffSurfaceProps["mode"];
  onToggleFile: DiffSurfaceProps["onToggleFile"];
  onSelectPath: DiffSurfaceProps["onSelectPath"];
}) {
  return (
    <View style={styles.header}>
      <DocumentFileHeader
        file={file}
        selectedPath={selectedPath}
        mode={mode}
        onToggleFile={onToggleFile}
        onSelectPath={onSelectPath}
      />
    </View>
  );
}

function NativeFileBody({
  file,
  model,
  mode,
  horizontalOffsets,
  presentation,
}: {
  file: DiffFileSection;
  model: DiffDocumentModel;
  mode: DiffSurfaceProps["mode"];
  horizontalOffsets: SharedValue<DiffHorizontalOffsets>;
  presentation: DiffSurfaceProps["reviewPresentation"];
}) {
  const touchRef = useRef<{ x: number; y: number; startedAt: number; moved: boolean } | null>(null);
  const reviewActions = mode.kind === "working" ? mode.reviewActions : undefined;
  const touchStart = useCallback((event: GestureResponderEvent) => {
    touchRef.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
      startedAt: Date.now(),
      moved: false,
    };
  }, []);
  const touchMove = useCallback((event: GestureResponderEvent) => {
    const touch = touchRef.current;
    if (
      touch &&
      Math.hypot(event.nativeEvent.pageX - touch.x, event.nativeEvent.pageY - touch.y) > 10
    ) {
      touch.moved = true;
    }
  }, []);
  const touchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const touch = touchRef.current;
      touchRef.current = null;
      if (!touch || touch.moved || Date.now() - touch.startedAt > 500 || !reviewActions) return;
      const hit = hitTestDiffBodyPoint({
        model,
        file,
        locationX: event.nativeEvent.locationX,
        locationY: event.nativeEvent.locationY,
        horizontalOffset: horizontalOffsetForPath(horizontalOffsets.value, file.path),
      });
      if (hit?.kind === "cell" && hit.target) {
        const line =
          mode.kind === "working"
            ? mode.fileReviews?.lineByTargetKey.get(hit.target.key)
            : undefined;
        if (line) presentation?.onSelectLine(line);
        reviewActions.onStartComment(hit.target);
      }
    },
    [file, horizontalOffsets, mode, model, presentation, reviewActions],
  );
  return (
    <View
      testID={`diff-file-${file.fileIndex}-body`}
      style={inlineUnistylesStyle<ViewStyle>({
        position: "relative",
        height: file.bodyHeight,
        zIndex: 2,
      })}
      onTouchStart={touchStart}
      onTouchMove={touchMove}
      onTouchEnd={touchEnd}
    >
      {!file.isCollapsed && !model.wrapLines ? (
        <HorizontalScroll file={file} offsets={horizontalOffsets} />
      ) : null}
    </View>
  );
}

function NativeReviewOverlays({
  model,
  mode,
  presentation,
}: {
  model: DiffDocumentModel;
  mode: DiffSurfaceProps["mode"];
  presentation: DiffSurfaceProps["reviewPresentation"];
}) {
  if (mode.kind !== "working") return null;
  const reviewActions = mode.reviewActions;
  return model.rows.flatMap((row) => {
    if (row.kind !== "line") return [];
    const columnWidth = model.viewportWidth / row.cells.length;
    return row.cells.flatMap((cell, index) => {
      const marker = cell && parseDiffContextMarker(cell.content);
      if (marker && presentation?.onExpandContext && index === row.cells.length - 1) {
        const file = model.files[row.fileIndex];
        return file
          ? [
              <NativeContextControl
                key={`${file.path}:${row.index}`}
                filePath={file.path}
                region={marker}
                top={row.top}
                height={row.height}
                onExpand={presentation.onExpandContext}
              />,
            ]
          : [];
      }
      if (!cell?.reviewTarget) return [];
      const thread = getInlineReviewThreadState({
        reviewTarget: cell.reviewTarget,
        reviewActions,
      });
      const changed = mode.fileReviews?.lineByTargetKey.get(cell.reviewTarget.key);
      const controls =
        changed && presentation
          ? [
              <NativeLineReviewControl
                key={`${cell.reviewTarget.key}:line-review`}
                targetKey={cell.reviewTarget.key}
                changedLine={changed}
                presentation={presentation}
                reviewed={mode.fileReviews?.reviewedLineIds.has(changed.id) === true}
                selected={presentation.selectedLineId === changed.id}
                top={row.top}
                left={index * columnWidth}
                height={model.lineHeight}
              />,
            ]
          : [];
      if (!thread || !reviewActions) return controls;
      return [
        ...controls,
        <View
          key={cell.reviewTarget.key}
          style={inlineUnistylesStyle<ViewStyle>({
            position: "absolute",
            top: row.top + row.height - row.reviewHeight,
            left: index * columnWidth,
            width: columnWidth,
            height: row.reviewHeight,
            zIndex: 6,
          })}
        >
          <InlineReviewThread
            reviewTarget={cell.reviewTarget}
            reviewActions={reviewActions}
            height={row.reviewHeight}
            viewportWidth={columnWidth}
            pinToViewport={!model.wrapLines}
          />
        </View>,
      ];
    });
  });
}

function NativeLineReviewControl({
  targetKey,
  changedLine,
  presentation,
  reviewed,
  selected,
  top,
  left,
  height,
}: {
  targetKey: string;
  changedLine: import("@/review").ReviewableChangedLine;
  presentation: NonNullable<DiffSurfaceProps["reviewPresentation"]>;
  reviewed: boolean;
  selected: boolean;
  top: number;
  left: number;
  height: number;
}) {
  const onPress = useCallback(() => {
    presentation.onSelectLine(changedLine);
    presentation.onToggleLine(changedLine);
  }, [changedLine, presentation]);
  const style = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top,
      left,
      width: LINE_REVIEW_DOT_GUTTER_WIDTH,
      height,
      zIndex: 7,
      borderLeftWidth: selected ? 2 : 0,
      borderLeftColor: "#0a84ff",
      alignItems: "center",
      justifyContent: "center",
    }),
    [height, left, selected, top],
  );
  return (
    <ReviewCheckbox
      appearance="dot"
      accessibilityLabel={reviewed ? "Mark line unreviewed" : "Mark line reviewed"}
      alwaysVisible
      testID={`diff-line-review-${targetKey}`}
      onPress={onPress}
      selected={selected}
      state={reviewed ? "reviewed" : "unreviewed"}
      style={style}
    />
  );
}

function NativeContextControl({
  filePath,
  region,
  top,
  height,
  onExpand,
}: {
  filePath: string;
  region: import("@/git/diff-context-expansion").DiffContextRegion;
  top: number;
  height: number;
  onExpand: NonNullable<Extract<DiffSurfaceProps["mode"], { kind: "working" }>["onExpandContext"]>;
}) {
  return (
    <DiffContextControl
      filePath={filePath}
      region={region}
      onExpand={onExpand}
      style={inlineUnistylesStyle<ViewStyle>({
        position: "absolute",
        top,
        left: 0,
        right: 0,
        height,
        zIndex: 8,
      })}
    />
  );
}

function NativeCanvasSlabView({
  slab,
  model,
  textLayout,
  paints,
  horizontalOffsets,
}: {
  slab: NativeCanvasSlab;
  model: DiffDocumentModel;
  textLayout: NativeTextLayout;
  paints: NativePaints;
  horizontalOffsets: SharedValue<DiffHorizontalOffsets>;
}) {
  const file = model.files[slab.fileIndex];
  const pictures = useMemo(
    () =>
      recordNativeSlabPictures({
        model,
        fileIndex: slab.fileIndex,
        top: slab.top,
        height: slab.height,
        viewportWidth: model.viewportWidth,
        textLayout,
        paints,
      }),
    [model, paints, slab.fileIndex, slab.height, slab.top, textLayout],
  );
  const style = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: slab.top,
      left: 0,
      right: 0,
      height: slab.height,
      zIndex: 3,
    }),
    [slab.height, slab.top],
  );
  if (!file) return null;
  const unifiedClip = {
    x: file.gutterWidth + CODE_LEFT_PADDING,
    width: model.viewportWidth - file.gutterWidth - CODE_LEFT_PADDING,
  };
  const columnWidth = model.viewportWidth / 2;
  const splitClipWidth = columnWidth - file.gutterWidth - CODE_LEFT_PADDING;
  return (
    <View pointerEvents="none" style={style} testID={`git-diff-canvas-${slab.key}`}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={pictures.fixed} />
      </Canvas>
      <NativeSlabCode
        picture={pictures.content.unified}
        path={slab.path}
        horizontalOffsets={horizontalOffsets}
        wrapLines={model.wrapLines}
        clipX={unifiedClip.x}
        clipWidth={unifiedClip.width}
        height={slab.height}
      />
      {model.layout === "split" ? (
        <>
          <NativeSlabCode
            picture={pictures.content.left}
            path={slab.path}
            horizontalOffsets={horizontalOffsets}
            wrapLines={model.wrapLines}
            clipX={file.gutterWidth + CODE_LEFT_PADDING}
            clipWidth={splitClipWidth}
            height={slab.height}
          />
          <NativeSlabCode
            picture={pictures.content.right}
            path={slab.path}
            horizontalOffsets={horizontalOffsets}
            wrapLines={model.wrapLines}
            clipX={columnWidth + file.gutterWidth + CODE_LEFT_PADDING}
            clipWidth={splitClipWidth}
            height={slab.height}
          />
        </>
      ) : null}
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Picture picture={pictures.gutter} />
      </Canvas>
    </View>
  );
}

function NativeSlabCode({
  picture,
  path,
  horizontalOffsets,
  wrapLines,
  clipX,
  clipWidth,
  height,
}: {
  picture: SkPicture;
  path: string;
  horizontalOffsets: SharedValue<DiffHorizontalOffsets>;
  wrapLines: boolean;
  clipX: number;
  clipWidth: number;
  height: number;
}) {
  const pictureTransform = useDerivedValue(() => [
    {
      translateX: -clipX - (wrapLines ? 0 : horizontalOffsetForPath(horizontalOffsets.value, path)),
    },
  ]);
  const clipStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: 0,
      left: clipX,
      width: clipWidth,
      height,
      overflow: "hidden",
    }),
    [clipWidth, clipX, height],
  );
  if (clipWidth <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={clipStyle}>
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Group transform={pictureTransform}>
          <Picture picture={picture} />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, position: "relative", overflow: "hidden" },
  scroll: { backgroundColor: "transparent" },
  header: { zIndex: 5 },
  shortcutHint: {
    position: "absolute",
    zIndex: 30,
    right: 12,
    bottom: 12,
    maxWidth: "95%",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(20,20,24,0.9)",
  },
  shortcutHintText: { color: "#ddd", fontSize: 12 },
});
