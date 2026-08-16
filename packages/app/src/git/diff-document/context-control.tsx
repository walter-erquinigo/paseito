import { ChevronDown, ChevronUp, ListChevronsUpDown } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiffContextRegion } from "@/git/diff-context-expansion";
import { contextControlPresentation, DIFF_CONTEXT_CONTROL_HEIGHT } from "./context-control-model";

function ContextIconAction({
  direction,
  count,
  onPress,
}: {
  direction: "up" | "down";
  count: number;
  onPress: () => void;
}) {
  const label = `Show ${count} lines ${direction === "up" ? "above" : "below"}`;
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Button
          accessibilityLabel={label}
          leftIcon={direction === "up" ? ChevronUp : ChevronDown}
          onPress={onPress}
          size="xs"
          style={styles.iconButton}
          testID={`diff-context-expand-${direction}`}
          variant="ghost"
        />
      </TooltipTrigger>
      <TooltipContent side="top">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export const DiffContextControl = memo(function DiffContextControl({
  filePath,
  region,
  onExpand,
  style,
}: {
  filePath: string;
  region: DiffContextRegion;
  onExpand: (
    filePath: string,
    region: DiffContextRegion,
    direction: "up" | "down" | "all",
  ) => void | Promise<void>;
  style?: StyleProp<ViewStyle>;
}) {
  const presentation = contextControlPresentation(region.lineCount);
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
    <View style={[styles.root, style]} testID="diff-context-control">
      <View style={styles.rule} />
      {presentation.kind === "large" ? (
        <ContextIconAction direction="up" count={presentation.edgeCount} onPress={expandUp} />
      ) : null}
      <Button
        accessibilityLabel={presentation.allLabel}
        leftIcon={presentation.kind === "small" ? ListChevronsUpDown : undefined}
        onPress={expandAll}
        size="xs"
        testID="diff-context-expand-all"
        variant="ghost"
      >
        {presentation.allLabel}
      </Button>
      {presentation.kind === "large" ? (
        <ContextIconAction direction="down" count={presentation.edgeCount} onPress={expandDown} />
      ) : null}
      <View style={styles.rule} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  root: {
    height: DIFF_CONTEXT_CONTROL_HEIGHT,
    minHeight: DIFF_CONTEXT_CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderTopWidth: theme.borderWidth[1],
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  rule: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
    flex: 1,
    minWidth: theme.spacing[3],
  },
  iconButton: {
    width: DIFF_CONTEXT_CONTROL_HEIGHT,
    paddingHorizontal: 0,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
