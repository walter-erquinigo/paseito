import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceLspLocation } from "@getpaseo/protocol/messages";
import {
  Image as RNImage,
  ScrollView as RNScrollView,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { type ASTNode, type MarkdownIt, type RenderRules } from "react-native-markdown-display";
import { StyleSheet, UnistylesRuntime, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { createSharedMarkdownRules, type MarkdownStyles } from "@/components/markdown/renderer";
import {
  AssistantFileLinkResolverProvider,
  AssistantMarkdownLink,
  type InlinePathTarget,
} from "@/assistant-file-links";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { filePreviewRenderKind } from "@/components/file-pane-render-mode";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { getFileNameFromPath } from "@/attachments/utils";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import {
  resolveWorkspaceFilePaths,
  type OpenFileDisposition,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { isFileQueryEnabled } from "@/components/file-pane-enabled";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { useLiveFile } from "./live-file/hook";
import { useFilePreview } from "./preview-lifecycle/hook";
import { resolveFilePreviewLifecycle } from "./preview-lifecycle/model";
import { FilePanelBar } from "./bar";
import { FileHtmlPreview } from "./html-preview";
import { FileMarkdownPreview } from "./markdown-preview";
import { FileEditorModel, getFileConflictCallout, type FileConflictCallout } from "./editor/model";
import { createFileObservationSource } from "./editor/observation-source";
import { FileEditorView } from "./editor/view";
import { FileSourceView } from "./source/view";
import type { FileConflictAlertState } from "./conflict-alert";
import type { LiveFileModel } from "./live-file/model";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import type { Theme } from "@/styles/theme";
import { usePaneContext } from "@/panels/pane-context";
import { useToast } from "@/contexts/toast-context";
import type { EditorLspSnapshot } from "./editor/lsp-session";
import { acquireEditorLspSession } from "./editor/lsp-session-pool";
import { lspLanguageForFile, useWorkspaceLspPreferences } from "./editor/lsp-preferences";
import { createMarkdownFilePreviewParser } from "./markdown-file-links";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  mode?: "preview" | "source";
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
  markdownParser: ReturnType<typeof MarkdownIt>;
  markdownRules: RenderRules;
}

type TextExplorerFile = ExplorerFile & { kind: "text" };

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ReadonlySource({
  preview,
  filename,
  location,
  navigationRevision,
}: {
  preview: ExplorerFile;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const theme = UnistylesRuntime.getTheme();
  const { t } = useTranslation();
  const visualTheme = useMemo(
    () => ({
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      surfaceRaised: theme.colors.surface3,
      codeBackground: theme.colors.surface2,
      uiFont: theme.fontFamily.ui,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [theme],
  );
  return (
    <FileSourceView
      content={preview.content ?? ""}
      filename={filename}
      location={location}
      navigationRevision={navigationRevision}
      size={preview.size}
      theme={visualTheme}
      tooLargeMessage={t("panels.file.tooLargeToDisplay")}
    />
  );
}

function TooLargeSource({ size }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centerState} testID="file-source-too-large">
      <Text style={styles.emptyText}>{t("panels.file.tooLargeToDisplay")}</Text>
      {size ? <Text style={styles.binaryMetaText}>{formatFileSize({ size })}</Text> : null}
    </View>
  );
}

function FilePreviewBody({
  preview,
  mode,
  isLoading,
  isMobile: _isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
  markdownParser,
  markdownRules,
}: FilePreviewBodyProps) {
  const { t } = useTranslation();
  const filePath = location.path;
  // A line target means the caller wants to land on that line, so fall back to
  // the highlighted source view even for renderable files.
  const renderKind =
    preview?.kind === "text" && !location.lineStart && mode !== "source"
      ? filePreviewRenderKind(filePath)
      : null;

  const previewScrollRef = useRef<RNScrollView>(null);

  const imageSource = useMemo(
    () => (imagePreviewUri ? { uri: imagePreviewUri } : null),
    [imagePreviewUri],
  );

  if (isLoading && !preview) {
    return (
      <View style={styles.centerState} testID="file-preview-loading">
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.centerState} testID="file-preview-unsupported">
        <Text style={styles.emptyText}>{t("panels.file.noPreview")}</Text>
      </View>
    );
  }

  if (preview.kind === "text") {
    if (renderKind === "html") {
      // The HTML document owns its own scrolling, so no ScrollView wrapper here.
      return (
        <View style={styles.previewScrollContainer}>
          <FileHtmlPreview html={preview.content ?? ""} testID="file-html-preview" />
        </View>
      );
    }

    if (renderKind === "markdown") {
      return (
        <View style={styles.previewScrollContainer}>
          <RNScrollView
            ref={previewScrollRef}
            style={styles.previewContent}
            showsVerticalScrollIndicator
          >
            <FileMarkdownPreview
              source={preview.content ?? ""}
              markdownit={markdownParser}
              rules={markdownRules}
            />
          </RNScrollView>
        </View>
      );
    }

    return (
      <ReadonlySource
        preview={preview}
        filename={filePath}
        location={location}
        navigationRevision={navigationRevision}
      />
    );
  }

  if (preview.kind === "image") {
    if (!imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>
      );
    }

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          contentContainerStyle={styles.previewImageScrollContent}
          showsVerticalScrollIndicator
        >
          <RNImage
            source={imageSource ?? undefined}
            style={styles.previewImage}
            resizeMode="contain"
          />
        </RNScrollView>
      </View>
    );
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
    </View>
  );
}

export function FilePane({
  serverId,
  workspaceRoot,
  location,
  navigationRevision,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { openFileInWorkspace } = usePaneContext();
  const isMobile = useIsCompactFormFactor();
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
  const supportsEditing = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceFileEditing === true,
  );
  // COMPAT(workspaceLsp): added in Paseito v0.2.5-paseito.9, remove after 2027-02-08.
  const supportsLsp = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceLsp === true,
  );
  // COMPAT(workspaceLspClangd): added in Paseito v0.4.0-paseito.15, remove after 2027-02-16.
  const supportsStandaloneClangd = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceLspClangd === true,
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const markdownParser = useMemo(
    () => createMarkdownFilePreviewParser(normalizedWorkspaceRoot),
    [normalizedWorkspaceRoot],
  );
  const markdownRules = useMemo(() => createMarkdownFilePreviewRules(), []);
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const readTarget = useMemo(
    () =>
      normalizedFilePath
        ? resolveFilePreviewReadTarget({
            path: normalizedFilePath,
            workspaceRoot: normalizedWorkspaceRoot,
          })
        : null,
    [normalizedFilePath, normalizedWorkspaceRoot],
  );

  // Re-read the file when this pane becomes visible again (#445). `isActive`
  // covers tab switches; active app visibility covers backgrounding and returning
  // from another window after an external edit. The gate lives in isFileQueryEnabled.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const enabled = isFileQueryEnabled({
    hasReadTarget: Boolean(client && readTarget),
    isTabActive: isActive,
    isAppVisible,
  });
  const liveFile = useLiveFile({
    client,
    cwd: readTarget?.cwd ?? null,
    path: readTarget?.path ?? null,
    enabled,
    liveUpdates: supportsEditing,
  });

  const targetKey = readTarget ? `${readTarget.cwd}:${readTarget.path}` : null;
  const previewLifecycle = useFilePreview({
    targetKey,
    liveFileSnapshot: liveFile.snapshot,
  });

  useEffect(
    () => setPreviewMode(location.openMode === "source" ? "source" : "preview"),
    [location.openMode, navigationRevision, readTarget?.path],
  );

  const { file: preview, imageAttachment } = resolveFilePreviewLifecycle(previewLifecycle);
  const imagePreviewUri = useAttachmentPreviewUrl(imageAttachment);
  const isRenderable = isRenderablePreview(preview, location.path);
  const editable = isEditableTextFile({
    preview,
    supportsEditing,
  });
  const canTogglePreviewMode = isRenderable && !location.lineStart;
  const lineCount =
    preview?.kind === "text" ? (preview.content ?? "").split("\n").length : undefined;
  const errorMessage = previewLifecycle.status === "error" ? previewLifecycle.message : null;
  const isLoading =
    previewLifecycle.status === "initial" ||
    previewLifecycle.status === "read_pending" ||
    previewLifecycle.status === "preparing";

  const handleOpenMarkdownFileLink = useCallback(
    (target: InlinePathTarget, disposition: OpenFileDisposition) => {
      void (async () => {
        const targetRead = resolveFilePreviewReadTarget({
          path: target.path,
          workspaceRoot: normalizedWorkspaceRoot,
        });
        if (!client || !targetRead) {
          showMarkdownFileNotFoundToast(toast, t, target.raw);
          return;
        }
        try {
          await client.readFile(targetRead.cwd, targetRead.path);
        } catch {
          showMarkdownFileNotFoundToast(toast, t, target.raw);
          return;
        }
        openFileInWorkspace({
          disposition: disposition === "side" ? "markdown-preview" : disposition,
          location: {
            path: target.path,
            lineStart: target.lineStart,
            lineEnd: target.lineEnd,
            column: target.column,
            openMode: "source",
          },
        });
      })();
    },
    [client, normalizedWorkspaceRoot, openFileInWorkspace, t, toast],
  );

  return (
    <AssistantFileLinkResolverProvider
      client={client}
      serverId={serverId}
      workspaceRoot={normalizedWorkspaceRoot}
      primaryDisposition="side"
      onOpenWorkspaceFile={handleOpenMarkdownFileLink}
      toast={toast}
    >
      <FilePanePresentation
        serverId={serverId}
        client={client}
        readTarget={readTarget}
        preview={preview}
        liveFile={liveFile.model}
        onRetryRead={liveFile.refresh}
        retryingRead={liveFile.isRetrying}
        retryLabel={t("common.actions.retry")}
        filename={getFileNameFromPath(location.path) ?? location.path}
        previewMode={canTogglePreviewMode ? previewMode : undefined}
        onPreviewModeChange={canTogglePreviewMode ? setPreviewMode : undefined}
        lineCount={lineCount}
        editable={editable}
        supportsLsp={supportsLsp}
        supportsStandaloneClangd={supportsStandaloneClangd}
        disconnectedMessage={t("workspace.terminal.hostDisconnected")}
        errorMessage={errorMessage}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
        imagePreviewUri={imagePreviewUri}
        markdownParser={markdownParser}
        markdownRules={markdownRules}
      />
    </AssistantFileLinkResolverProvider>
  );
}

function showMarkdownFileNotFoundToast(
  toast: ReturnType<typeof useToast>,
  t: ReturnType<typeof useTranslation>["t"],
  token: string,
): void {
  toast.show(t("common.errors.noFileFound", { token }), {
    variant: "error",
    testID: "assistant-file-link-not-found-toast",
  });
}

interface FilePreviewMarkdownAstNode extends ASTNode {
  sourceInfo?: string;
}

function createMarkdownFilePreviewRules(): RenderRules {
  return {
    ...createSharedMarkdownRules(),
    link: (
      node: FilePreviewMarkdownAstNode,
      children: React.ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
    ) => (
      <AssistantMarkdownLink
        key={node.key}
        source={getMarkdownFilePreviewLinkSource(node)}
        style={styles.link}
      >
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return child;
          const childProps = child.props as { style?: StyleProp<TextStyle> };
          return React.cloneElement(child, {
            style: [childProps.style, { color: styles.link.color }],
          } as Partial<{ style: StyleProp<TextStyle> }>);
        })}
      </AssistantMarkdownLink>
    ),
  };
}

function getMarkdownFilePreviewLinkSource(node: FilePreviewMarkdownAstNode) {
  return {
    href: typeof node.attributes?.href === "string" ? node.attributes.href : "",
    text: getMarkdownNodeText(node),
    markup: node.markup,
    sourceInfo: node.sourceInfo,
    sourceType: "file-preview" as const,
  };
}

function getMarkdownNodeText(node: ASTNode): string {
  if (!node.children.length) {
    return node.content ?? "";
  }
  return node.children.map(getMarkdownNodeText).join("");
}

function isRenderablePreview(preview: ExplorerFile | null, path: string): boolean {
  return preview?.kind === "text" && filePreviewRenderKind(path) !== null;
}

function isEditableTextFile(input: {
  preview: ExplorerFile | null;
  supportsEditing: boolean;
}): boolean {
  return Boolean(
    isWeb &&
    input.supportsEditing &&
    input.preview?.kind === "text" &&
    input.preview.size <= 1024 * 1024,
  );
}

function FilePanePresentation({
  serverId,
  client,
  readTarget,
  preview,
  liveFile,
  onRetryRead,
  retryingRead,
  retryLabel,
  filename,
  previewMode,
  onPreviewModeChange,
  lineCount,
  editable,
  supportsLsp,
  supportsStandaloneClangd,
  disconnectedMessage,
  errorMessage,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  imagePreviewUri,
  markdownParser,
  markdownRules,
}: {
  serverId: string;
  client: DaemonClient | null;
  readTarget: { cwd: string; path: string } | null;
  preview: ExplorerFile | null;
  liveFile: LiveFileModel;
  onRetryRead: () => void;
  retryingRead: boolean;
  retryLabel: string;
  filename: string;
  previewMode?: "preview" | "source";
  onPreviewModeChange?: (mode: "preview" | "source") => void;
  lineCount?: number;
  editable: boolean;
  supportsLsp: boolean;
  supportsStandaloneClangd: boolean;
  disconnectedMessage: string;
  errorMessage: string | null;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  imagePreviewUri: string | null;
  markdownParser: ReturnType<typeof MarkdownIt>;
  markdownRules: RenderRules;
}) {
  if (!client && readTarget) {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{disconnectedMessage}</Text>
        </View>
      </View>
    );
  }

  if (editable && client && readTarget && preview?.kind === "text") {
    return (
      <EditableFilePane
        key={`${serverId}:${readTarget.cwd}:${readTarget.path}`}
        client={client}
        serverId={serverId}
        cwd={readTarget.cwd}
        path={readTarget.path}
        preview={preview as TextExplorerFile}
        liveFile={liveFile}
        onRetryRead={onRetryRead}
        retryingRead={retryingRead}
        filename={filename}
        mode={previewMode}
        onModeChange={onPreviewModeChange}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
        supportsLsp={supportsLsp}
        supportsStandaloneClangd={supportsStandaloneClangd}
        markdownParser={markdownParser}
        markdownRules={markdownRules}
      />
    );
  }

  if (errorMessage) {
    if (errorMessage === "File is too large to display") {
      return (
        <View style={styles.container} testID="workspace-file-pane">
          <TooLargeSource />
        </View>
      );
    }
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Button variant="outline" size="sm" onPress={onRetryRead} loading={retryingRead}>
            {retryLabel}
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {preview ? (
        <FilePanelBar
          size={preview.size}
          lineCount={lineCount}
          mode={previewMode}
          onModeChange={onPreviewModeChange}
        />
      ) : null}
      <FilePreviewBody
        preview={preview}
        mode={previewMode}
        isLoading={isLoading}
        isMobile={isMobile}
        location={location}
        navigationRevision={navigationRevision}
        imagePreviewUri={imagePreviewUri}
        markdownParser={markdownParser}
        markdownRules={markdownRules}
      />
    </View>
  );
}

function EditableFilePane({
  client,
  serverId,
  cwd,
  path,
  preview,
  liveFile,
  onRetryRead,
  retryingRead,
  filename,
  mode,
  onModeChange,
  isLoading,
  isMobile,
  location,
  navigationRevision,
  supportsLsp,
  supportsStandaloneClangd,
  markdownParser,
  markdownRules,
}: {
  client: DaemonClient;
  serverId: string;
  cwd: string;
  path: string;
  preview: TextExplorerFile;
  liveFile: LiveFileModel;
  onRetryRead: () => void;
  retryingRead: boolean;
  filename: string;
  mode?: "preview" | "source";
  onModeChange?: (mode: "preview" | "source") => void;
  isLoading: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  supportsLsp: boolean;
  supportsStandaloneClangd: boolean;
  markdownParser: ReturnType<typeof MarkdownIt>;
  markdownRules: RenderRules;
}) {
  const { settings } = useAppSettings();
  const { t } = useTranslation();
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [vimMode, setVimMode] = useState<string | null>(settings.vimKeybindings ? "NORMAL" : null);
  const language = lspLanguageForFile(filename);
  const lspPreferences = useWorkspaceLspPreferences({ serverId, cwd, language });
  const [lspSnapshot, setLspSnapshot] = useState<EditorLspSnapshot>({
    status: "connecting",
    error: null,
    provider: null,
  });
  const lspLease = useMemo(
    () =>
      supportsLsp && language && lspPreferences.enabled
        ? acquireEditorLspSession({
            client,
            cwd,
            path,
            content: preview.content ?? "",
            onStatus: setLspSnapshot,
          })
        : null,
    [client, cwd, language, lspPreferences.enabled, path, preview.content, supportsLsp],
  );
  const lspSession = lspLease?.session ?? null;
  const lspSessionRef = useRef(lspSession);
  const formatOnSaveRef = useRef(lspPreferences.formatOnSave);
  lspSessionRef.current = lspSession;
  formatOnSaveRef.current = lspPreferences.formatOnSave;
  const retryLsp = useCallback(() => {
    void lspSessionRef.current?.retry();
  }, []);
  const session = useMemo(
    () => ({
      async prepareWrite(content: string) {
        const activeLsp = lspSessionRef.current;
        return activeLsp && formatOnSaveRef.current ? activeLsp.format(content) : content;
      },
      write(input: { content: string; expectedModifiedAt: string; expectedRevision?: string }) {
        return client.writeFile({ cwd, path, ...input });
      },
    }),
    [client, cwd, path],
  );
  const [model] = useState(() => {
    return new FileEditorModel({
      file: {
        content: preview.content ?? "",
        hasBom: preview.hasBom,
        version: {
          status: "ready",
          cwd,
          path,
          size: preview.size,
          modifiedAt: preview.modifiedAt,
          revision: preview.revision,
        },
      },
      session,
    });
  });
  useEffect(() => {
    const source = createFileObservationSource(liveFile);
    model.connectFileObservations(source);
    return () => model.disconnectFileObservations();
  }, [liveFile, model]);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const { openFileInWorkspace } = usePaneContext();
  const suspendPendingSave = useCallback(() => model.suspendAutosave(), [model]);
  usePublishPanelInstanceAttributes({ modified: snapshot.modified, suspendPendingSave });
  const theme = UnistylesRuntime.getTheme();
  const visualTheme = useMemo(
    () => ({
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      surfaceRaised: theme.colors.surface3,
      codeBackground: theme.colors.surface2,
      uiFont: theme.fontFamily.ui,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [
      theme.colors.border,
      theme.colors.foreground,
      theme.colors.foregroundMuted,
      theme.colors.surface0,
      theme.colors.surface2,
      theme.colors.surface3,
      theme.colors.syntax,
      theme.colors.terminal.cursor,
      theme.colors.terminal.selectionBackground,
      theme.colorScheme,
      theme.fontFamily.mono,
      theme.fontFamily.ui,
      theme.fontSize.code,
    ],
  );

  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => {
    if (!lspSession) {
      setLspSnapshot({ status: "connecting", error: null, provider: null });
      return;
    }
    void lspSession.open(model.getSnapshot().content);
    return () => lspLease?.release();
  }, [lspLease, lspSession, model]);

  const handleReload = useCallback(() => {
    if (!snapshot.modified) {
      void model.reload();
      return;
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("panels.file.editor.reloadTitle"),
        message: t("panels.file.editor.reloadMessage"),
        confirmLabel: t("panels.file.editor.reload"),
        destructive: true,
      });
      if (confirmed) void model.reload();
    })();
  }, [model, snapshot.modified, t]);
  const handleOverwrite = useCallback(() => void model.overwrite(), [model]);
  const conflict = fileConflictAlertState({
    callout: getFileConflictCallout(snapshot),
    onOverwrite: handleOverwrite,
    onReload: handleReload,
    onRetry: onRetryRead,
    retrying: retryingRead,
  });
  const handleVimModeChange = useCallback((nextMode: string | null) => setVimMode(nextMode), []);
  const handleOpenDefinition = useCallback(
    (definition: WorkspaceLspLocation) => {
      let absolutePath: string;
      try {
        const url = new URL(definition.uri);
        if (url.protocol !== "file:") return;
        absolutePath = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
      } catch {
        return;
      }
      const paths = resolveWorkspaceFilePaths({ path: absolutePath, workspaceRoot: cwd });
      if (!paths?.relativePath) return;
      openFileInWorkspace({
        disposition: "main",
        location: {
          path: paths.relativePath,
          lineStart: definition.range.start.line + 1,
          lineEnd: definition.range.end.line + 1,
          openMode: "source",
        },
      });
    },
    [cwd, openFileInWorkspace],
  );
  const renderedPreview = useMemo<ExplorerFile>(
    () => ({
      ...preview,
      content: snapshot.content,
      size: snapshot.version.status === "ready" ? snapshot.version.size : preview.size,
      modifiedAt:
        snapshot.version.status === "ready" ? snapshot.version.modifiedAt : preview.modifiedAt,
    }),
    [preview, snapshot.content, snapshot.version],
  );
  const showSource = mode !== "preview";
  const lspBar = useMemo(
    () =>
      supportsLsp && language
        ? {
            enabled: lspPreferences.enabled,
            formatOnSave: lspPreferences.formatOnSave,
            language,
            snapshot: lspSnapshot,
            standaloneClangdSupported: supportsStandaloneClangd,
            onEnabledChange: lspPreferences.setEnabled,
            onFormatOnSaveChange: lspPreferences.setFormatOnSave,
            onRetry: retryLsp,
          }
        : undefined,
    [
      language,
      lspPreferences.enabled,
      lspPreferences.formatOnSave,
      lspPreferences.setEnabled,
      lspPreferences.setFormatOnSave,
      lspSnapshot,
      retryLsp,
      supportsStandaloneClangd,
      supportsLsp,
    ],
  );

  return (
    <View style={styles.container} testID="workspace-file-pane">
      <FilePanelBar
        size={
          snapshot.observedVersion.status === "ready" ? snapshot.observedVersion.size : preview.size
        }
        lineCount={snapshot.content.split("\n").length}
        editorStatus={snapshot.status}
        cursor={showSource ? cursor : undefined}
        vimMode={showSource ? vimMode : null}
        conflict={conflict}
        lsp={lspBar}
        mode={mode}
        onModeChange={onModeChange}
      />
      {showSource ? (
        <FileEditorView
          model={model}
          filename={filename}
          location={location}
          navigationRevision={navigationRevision}
          vimEnabled={settings.vimKeybindings}
          theme={visualTheme}
          lspSession={lspSession}
          onOpenDefinition={handleOpenDefinition}
          onCursorChange={setCursor}
          onVimModeChange={handleVimModeChange}
        />
      ) : (
        <FilePreviewBody
          preview={renderedPreview}
          mode={mode}
          isLoading={isLoading}
          isMobile={isMobile}
          location={location}
          navigationRevision={navigationRevision}
          imagePreviewUri={null}
          markdownParser={markdownParser}
          markdownRules={markdownRules}
        />
      )}
    </View>
  );
}

function fileConflictAlertState(input: {
  callout: FileConflictCallout | null;
  onOverwrite(): void;
  onReload(): void;
  onRetry(): void;
  retrying: boolean;
}): FileConflictAlertState | undefined {
  if (!input.callout) return undefined;
  if (input.callout.kind === "deleted") return { kind: "deleted" };
  if (input.callout.kind === "checkFailed") {
    return { kind: "checkFailed", retrying: input.retrying, onRetry: input.onRetry };
  }
  return {
    kind: "changed",
    canOverwrite: input.callout.canOverwrite,
    onReload: input.onReload,
    onOverwrite: input.onOverwrite,
  };
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  binaryMetaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  previewContent: {
    flex: 1,
    minHeight: 0,
  },
  previewCodeScrollContent: {
    padding: theme.spacing[4],
  },
  previewImageScrollContent: {
    flexGrow: 1,
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 420,
  },
}));
