import { Text, View } from "react-native";
import { useCallback } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Theme } from "@/styles/theme";
import { FileConflictAlert, type FileConflictAlertState } from "./conflict-alert";
import type { FileEditorStatus } from "./editor/model";
import type { EditorLspStatus } from "./editor/lsp-session";
import type { WorkspaceLspLanguage } from "./editor/lsp-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const spinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function FilePanelBar({
  size,
  lineCount,
  mode,
  onModeChange,
  editorStatus,
  cursor,
  vimMode,
  conflict,
  lsp,
}: {
  size: number;
  lineCount?: number;
  mode?: "preview" | "source";
  onModeChange?(mode: "preview" | "source"): void;
  editorStatus?: FileEditorStatus;
  cursor?: { line: number; column: number };
  vimMode?: string | null;
  conflict?: FileConflictAlertState;
  lsp?: {
    enabled: boolean;
    formatOnSave: boolean;
    language: WorkspaceLspLanguage;
    status: EditorLspStatus;
    onEnabledChange(enabled: boolean): void;
    onFormatOnSaveChange(enabled: boolean): void;
  };
}) {
  const { t } = useTranslation();
  const previewModes = [
    {
      value: "preview" as const,
      label: t("panels.file.editor.preview"),
      testID: "file-mode-preview",
    },
    { value: "source" as const, label: t("panels.file.editor.source"), testID: "file-mode-source" },
  ];
  return (
    <View style={styles.chrome} testID="file-panel-bar">
      <View style={styles.row}>
        <View style={styles.metadata}>
          <Text
            style={styles.whisper}
            accessibilityLabel={t("panels.file.editor.fileSize", { size: formatFileSize(size) })}
          >
            {formatFileSize(size)}
          </Text>
          {lineCount !== undefined ? (
            <Text
              style={styles.whisper}
              accessibilityLabel={t("panels.file.editor.lines", { count: lineCount })}
            >
              {t("panels.file.editor.lines", { count: lineCount })}
            </Text>
          ) : null}
        </View>
        <View
          style={styles.status}
          accessibilityLabel={
            editorStatus
              ? t("panels.file.editor.editorStatus", { status: editorStatus })
              : undefined
          }
        >
          {editorStatus === "dirty" ? (
            <View
              style={styles.dirtyDot}
              accessibilityLabel={t("panels.file.editor.unsavedChanges")}
            />
          ) : null}
          {editorStatus === "saving" ? (
            <>
              <ThemedSpinner size={14} uniProps={spinnerMapping} />
              <Text style={styles.secondary}>{t("panels.file.editor.saving")}</Text>
            </>
          ) : null}
          {editorStatus === "error" ? (
            <Text style={styles.error}>{t("panels.file.editor.saveFailed")}</Text>
          ) : null}
          {vimMode ? (
            <Text
              style={styles.vim}
              accessibilityLabel={t("panels.file.editor.vimMode", { mode: vimMode })}
            >
              {vimMode}
            </Text>
          ) : null}
          {cursor ? (
            <Text
              style={styles.whisper}
              accessibilityLabel={t("panels.file.editor.cursor", cursor)}
            >
              Ln {cursor.line}, Col {cursor.column}
            </Text>
          ) : null}
        </View>
        {mode && onModeChange ? (
          <SegmentedControl
            size="xs"
            value={mode}
            onValueChange={onModeChange}
            testID="file-preview-mode"
            options={previewModes}
          />
        ) : null}
        {lsp ? <FileLspMenu {...lsp} /> : null}
      </View>
      {conflict ? <FileConflictAlert state={conflict} /> : null}
    </View>
  );
}

function FileLspMenu({
  enabled,
  formatOnSave,
  language,
  status,
  onEnabledChange,
  onFormatOnSaveChange,
}: NonNullable<Parameters<typeof FilePanelBar>[0]["lsp"]>) {
  const statusLabel = lspStatusLabel(enabled, status);
  const toggleEnabled = useCallback(() => onEnabledChange(!enabled), [enabled, onEnabledChange]);
  const toggleFormatOnSave = useCallback(
    () => onFormatOnSaveChange(!formatOnSave),
    [formatOnSave, onFormatOnSaveChange],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.lspTrigger}
        accessibilityLabel="Language server settings"
        testID="file-lsp-menu"
      >
        <Text style={status === "unavailable" && enabled ? styles.error : styles.secondary}>
          {statusLabel}
        </Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={240}>
        <DropdownMenuItem
          selected={enabled}
          closeOnSelect={false}
          onSelect={toggleEnabled}
          testID="file-lsp-workspace-toggle"
        >
          Enable LSP for this workspace
        </DropdownMenuItem>
        <DropdownMenuItem
          selected={formatOnSave}
          disabled={!enabled}
          closeOnSelect={false}
          onSelect={toggleFormatOnSave}
          testID="file-lsp-format-toggle"
        >
          Format {language === "cpp" ? "C/C++" : "Python"} on save
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function lspStatusLabel(enabled: boolean, status: EditorLspStatus): string {
  if (!enabled) return "LSP off";
  if (status === "ready") return "LSP";
  if (status === "connecting") return "LSP…";
  return "LSP unavailable";
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create((theme) => ({
  chrome: {
    flexShrink: 0,
    backgroundColor: theme.colors.surface1,
  },
  row: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  metadata: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  secondary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  whisper: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.xs },
  error: { color: theme.colors.palette.red[300], fontSize: theme.fontSize.xs },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  status: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  lspTrigger: {
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  vim: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
}));
