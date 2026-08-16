import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EditorLspSnapshot, EditorLspStatus } from "./editor/lsp-session";
import type { WorkspaceLspLanguage } from "./editor/lsp-preferences";

export interface LspStatusMenuProps {
  enabled: boolean;
  snapshot: EditorLspSnapshot;
  language: WorkspaceLspLanguage;
  standaloneClangdSupported: boolean;
  pausedReason?: string | null;
  formatOnSave?: boolean;
  onEnabledChange(enabled: boolean): void;
  onFormatOnSaveChange?(enabled: boolean): void;
  onRetry(): void;
  testIDPrefix?: string;
}

export function LspStatusMenu({
  enabled,
  snapshot,
  language,
  standaloneClangdSupported,
  pausedReason,
  formatOnSave,
  onEnabledChange,
  onFormatOnSaveChange,
  onRetry,
  testIDPrefix = "file-lsp",
}: LspStatusMenuProps) {
  const paused = Boolean(pausedReason);
  const statusLabel = lspStatusLabel(enabled, snapshot, paused);
  const toggleEnabled = useCallback(() => onEnabledChange(!enabled), [enabled, onEnabledChange]);
  const toggleFormatOnSave = useCallback(
    () => onFormatOnSaveChange?.(!formatOnSave),
    [formatOnSave, onFormatOnSaveChange],
  );
  const unavailable = snapshot.status === "unavailable" && enabled && !paused;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.trigger}
        accessibilityLabel="Language server settings"
        testID={`${testIDPrefix}-menu`}
      >
        <Text style={unavailable ? styles.error : styles.secondary}>{statusLabel}</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={320}>
        <DropdownMenuItem
          selected={enabled}
          disabled={paused}
          closeOnSelect={false}
          onSelect={toggleEnabled}
          testID={`${testIDPrefix}-workspace-toggle`}
        >
          Enable LSP for this workspace
        </DropdownMenuItem>
        {onFormatOnSaveChange ? (
          <DropdownMenuItem
            selected={formatOnSave}
            disabled={!enabled || paused}
            closeOnSelect={false}
            onSelect={toggleFormatOnSave}
            testID={`${testIDPrefix}-format-toggle`}
          >
            Format {language === "cpp" ? "C/C++" : "Python"} on save
          </DropdownMenuItem>
        ) : null}
        {snapshot.provider && !paused ? (
          <DropdownMenuHint trailing={snapshot.provider} testID={`${testIDPrefix}-provider`}>
            Provider
          </DropdownMenuHint>
        ) : null}
        {pausedReason ? (
          <View style={styles.detail} testID={`${testIDPrefix}-paused`}>
            <Text style={styles.detailText}>{pausedReason}</Text>
          </View>
        ) : null}
        {language === "cpp" && !standaloneClangdSupported && !paused ? (
          <View style={styles.detail} testID={`${testIDPrefix}-host-update-required`}>
            <Text style={styles.detailText}>
              Update this host to use Paseito&apos;s standalone clangd.
            </Text>
          </View>
        ) : null}
        {snapshot.error && !paused ? (
          <View style={styles.detail} accessibilityRole="alert" testID={`${testIDPrefix}-error`}>
            <Text style={styles.errorText}>{snapshot.error}</Text>
          </View>
        ) : null}
        {unavailable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              closeOnSelect={false}
              onSelect={onRetry}
              testID={`${testIDPrefix}-retry`}
            >
              Retry LSP
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function lspStatusLabel(
  enabled: boolean,
  snapshot: Pick<EditorLspSnapshot, "status" | "provider">,
  paused: boolean,
): string {
  if (paused) return "LSP paused";
  if (!enabled) return "LSP off";
  if (snapshot.status === "ready") {
    return snapshot.provider ? `LSP · ${snapshot.provider}` : "LSP";
  }
  if (snapshot.status === "connecting") return "LSP…";
  return "LSP unavailable";
}

export function getLspStatusLabel(
  enabled: boolean,
  status: EditorLspStatus,
  provider: EditorLspSnapshot["provider"] = null,
  paused = false,
): string {
  return lspStatusLabel(enabled, { status, provider }, paused);
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    minHeight: 24,
    minWidth: 104,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  secondary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.palette.red[300], fontSize: theme.fontSize.sm },
  detail: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  detailText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
