import { createElement, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { GitCompareArrows } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  defaultBaseRef?: string;
  recordedBaseRef?: string;
  selectedBaseRef: string | null;
  effectiveBaseRef?: string;
  supported: boolean;
  onSelect: (baseRef: string | null) => Promise<void>;
}

const ThemedGitCompareArrows = withUnistyles(GitCompareArrows);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ChangesBaseSelector({
  serverId,
  cwd,
  currentBranch,
  defaultBaseRef,
  recordedBaseRef,
  selectedBaseRef,
  effectiveBaseRef,
  supported,
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
    enabled: supported && open && Boolean(client) && isConnected,
    retry: false,
    staleTimeMs: 15_000,
    dataShape: "list",
  });
  const options = useMemo(
    () =>
      buildChangesBaseOptions({
        branches: suggestionsQuery.data ?? [],
        currentBranch,
        defaultBaseRef,
        recordedBaseRef,
        selectedBaseRef,
      }),
    [currentBranch, defaultBaseRef, recordedBaseRef, selectedBaseRef, suggestionsQuery.data],
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
        await onSelect(baseRef === defaultBaseRef ? null : baseRef);
      })().catch((error) => {
        toast.error(
          error instanceof Error ? error.message : t("workspace.git.diff.baseSelectorError"),
        );
      });
    },
    [client, cwd, defaultBaseRef, onSelect, t, toast],
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
  const accessibilityState = useMemo(() => ({ disabled: !supported }), [supported]);
  const handleOpen = useCallback(() => {
    if (supported) {
      setOpen(true);
    }
  }, [supported]);

  if (!currentBranch) {
    return null;
  }
  const label =
    displayChangesBaseRef(effectiveBaseRef ?? recordedBaseRef) ?? t("workspace.git.diff.base");
  const value = normalizeChangesBaseRef(effectiveBaseRef ?? recordedBaseRef) ?? label;

  const trigger = (
    <Pressable
      testID="changes-base-selector"
      accessibilityRole="button"
      accessibilityLabel={
        supported
          ? t("workspace.git.diff.baseSelectorLabel", { baseRef: label })
          : t("workspace.git.diff.baseSelectorUpdateHost")
      }
      accessibilityState={accessibilityState}
      onPress={handleOpen}
      style={triggerStyle}
    >
      <ThemedGitCompareArrows size={13} uniProps={iconColorMapping} />
      <Text style={[styles.label, !supported && styles.disabledLabel]} numberOfLines={1}>
        <Text style={styles.prefix}>{t("workspace.git.diff.base")}:</Text> {label}
      </Text>
    </Pressable>
  );

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      {supported ? (
        trigger
      ) : (
        <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom" align="start" offset={6}>
            <Text style={styles.tooltipText}>{t("workspace.git.diff.baseSelectorUpdateHost")}</Text>
          </TooltipContent>
        </Tooltip>
      )}
      {supported ? (
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
      ) : null}
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
  prefix: {
    textTransform: "capitalize",
  },
  disabledLabel: {
    opacity: theme.opacity[50],
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));
