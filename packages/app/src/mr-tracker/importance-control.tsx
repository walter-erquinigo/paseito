import { useCallback, useMemo, type ComponentType } from "react";
import { CircleMinus, Star } from "lucide-react-native";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import type { MRImportance } from "./types";

export function ImportanceControl({
  value,
  disabled,
  onChange,
}: {
  value: MRImportance;
  disabled: boolean;
  onChange: (value: MRImportance) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      {
        value: "important" as const,
        label: t("mrTracker.importance.important"),
        hint: t("mrTracker.importanceHints.important"),
        icon: Star,
      },
      {
        value: "ignored" as const,
        label: t("mrTracker.importance.ignored"),
        hint: t("mrTracker.importanceHints.ignored"),
        icon: CircleMinus,
      },
    ],
    [t],
  );

  return (
    <View style={styles.control} testID="mr-importance">
      {options.map((option) => (
        <ImportanceOption
          key={option.value}
          option={option.value}
          label={option.label}
          hint={option.hint}
          icon={option.icon}
          selected={option.value === value}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function ImportanceOption({
  option,
  label,
  hint,
  icon,
  selected,
  disabled,
  onChange,
}: {
  option: MRImportance;
  label: string;
  hint: string;
  icon: ComponentType<{ color: string; size: number }>;
  selected: boolean;
  disabled: boolean;
  onChange: (value: MRImportance) => void;
}) {
  const handlePressIn = useCallback((event: GestureResponderEvent) => event.stopPropagation(), []);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onChange(option);
    },
    [onChange, option],
  );
  const optionStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.option,
      selected && styles.optionSelected,
      pressed && styles.optionPressed,
      disabled && styles.optionDisabled,
    ],
    [disabled, selected],
  );
  const accessibilityState = useMemo(() => ({ selected, disabled }), [disabled, selected]);

  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild disabled={disabled}>
        <Pressable
          accessibilityRole="button"
          accessibilityHint={hint}
          accessibilityState={accessibilityState}
          disabled={disabled}
          onPressIn={handlePressIn}
          onPress={handlePress}
          style={optionStyle}
          testID={`mr-importance-${option}`}
        >
          <ThemedImportanceIcon
            icon={icon}
            size={12}
            uniProps={selected ? selectedIconMapping : mutedIconMapping}
          />
          <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{hint}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ImportanceIcon({
  icon: Icon,
  size,
  iconColor,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  size: number;
  iconColor: string;
}) {
  return <Icon color={iconColor} size={size} />;
}

const ThemedImportanceIcon = withUnistyles(ImportanceIcon);
const selectedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foreground });
const mutedIconMapping = (theme: Theme) => ({ iconColor: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface0,
  },
  option: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  optionSelected: { backgroundColor: theme.colors.surface3 },
  optionPressed: { opacity: 0.8 },
  optionDisabled: { opacity: theme.opacity[50] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  labelSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
