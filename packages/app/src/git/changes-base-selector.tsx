import { createElement, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { GitCompareArrows } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import type { Theme } from "@/styles/theme";
import {
  buildChangesBaseOptions,
  displayChangesBaseRef,
  normalizeChangesBaseRef,
} from "./changes-base-selection";

interface ChangesBaseSelectorProps {
  serverId: string;
  cwd: string;
  currentBranch: string | null;
  recordedBaseRef?: string;
  selectedBaseRef: string | null;
  effectiveBaseRef?: string;
  onSelect: (baseRef: string | null) => Promise<void>;
}

const ThemedGitCompareArrows = withUnistyles(GitCompareArrows);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ChangesBaseSelector({
  serverId,
  cwd,
  currentBranch,
  recordedBaseRef,
  selectedBaseRef,
  effectiveBaseRef,
  onSelect,
}: ChangesBaseSelectorProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const suggestionsQuery = useFetchQuery({
    queryKey: ["changesBaseSuggestions", serverId, cwd],
    queryFn: async () => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.getBranchSuggestions({ cwd, limit: 200 });
      if (payload.error) {
        throw new Error(payload.error);
      }
      const details = payload.branchDetails ?? [];
      return details.length > 0 ? details : payload.branches.map((name) => ({ name }));
    },
    enabled: open && Boolean(client) && isConnected,
    retry: false,
    staleTimeMs: 15_000,
    dataShape: "list",
  });
  const options = useMemo(
    () =>
      buildChangesBaseOptions({
        branches: suggestionsQuery.data ?? [],
        currentBranch,
        recordedBaseRef,
        selectedBaseRef,
      }),
    [currentBranch, recordedBaseRef, selectedBaseRef, suggestionsQuery.data],
  );

  const handleSelect = useCallback(
    (baseRef: string) => {
      void (async () => {
        if (!client) {
          return;
        }
        const validation = await client.validateBranch({ cwd, branchName: baseRef });
        if (validation.error) {
          throw new Error(validation.error);
        }
        if (!validation.exists) {
          throw new Error(t("workspace.git.diff.baseSelectorMissing", { baseRef }));
        }
        await onSelect(baseRef === recordedBaseRef ? null : baseRef);
      })().catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.diff.baseSelectorError"),
        );
      });
    },
    [client, cwd, onSelect, recordedBaseRef, t, toast],
  );
  const renderOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={createElement(ThemedGitCompareArrows, {
          size: 14,
          uniProps: iconColorMapping,
        })}
      />
    ),
    [],
  );
  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      (Boolean(hovered) || pressed || open) && styles.triggerHovered,
    ],
    [open],
  );
  const handleOpen = useCallback(() => setOpen(true), []);

  if (!currentBranch) {
    return null;
  }
  const label =
    displayChangesBaseRef(effectiveBaseRef ?? recordedBaseRef) ?? t("workspace.git.diff.base");
  const value = normalizeChangesBaseRef(effectiveBaseRef ?? recordedBaseRef) ?? label;

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Pressable
        testID="changes-base-selector"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.diff.baseSelectorLabel", { baseRef: label })}
        onPress={handleOpen}
        style={triggerStyle}
      >
        <ThemedGitCompareArrows size={13} uniProps={iconColorMapping} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        searchable
        title={t("workspace.git.diff.baseSelectorTitle")}
        searchPlaceholder={t("workspace.git.diff.baseSelectorSearch")}
        emptyText={t("workspace.git.diff.baseSelectorEmpty")}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopMinWidth={280}
        desktopPreventInitialFlash
        renderOption={renderOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    minWidth: 0,
    flexShrink: 1,
  },
  trigger: {
    height: 24,
    minWidth: 0,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  label: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
