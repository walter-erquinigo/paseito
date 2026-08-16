import { Circle, CircleCheck, CircleMinus } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { reviewCheckboxVisibility, type ReviewCheckboxState } from "./review-checkbox-model";

type ReviewPressableState = PressableStateCallbackType & { hovered?: boolean };

const ThemedCircle = withUnistyles(Circle);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleMinus = withUnistyles(CircleMinus);
const mutedIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const activeIconMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});

export const ReviewCheckbox = memo(function ReviewCheckbox({
  state,
  alwaysVisible = false,
  selected = false,
  accessibilityLabel,
  onPress,
  style,
  testID,
}: {
  state: ReviewCheckboxState;
  alwaysVisible?: boolean;
  selected?: boolean;
  accessibilityLabel: string;
  onPress: (event: { stopPropagation: () => void }) => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
}) {
  const [focused, setFocused] = useState(false);
  const accessibilityState = useMemo(
    () => ({ checked: state === "mixed" ? ("mixed" as const) : state === "reviewed" }),
    [state],
  );
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);
  const pressableStyle = useCallback(
    ({ hovered = false, pressed }: ReviewPressableState) => [
      styles.root,
      style,
      reviewCheckboxVisibility({ state, alwaysVisible, selected, hovered, focused })
        ? styles.visible
        : styles.hidden,
      pressed ? styles.pressed : null,
    ],
    [alwaysVisible, focused, selected, state, style],
  );
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPress={onPress}
      style={pressableStyle}
      testID={testID}
    >
      {({ hovered = false }: ReviewPressableState) => {
        const mapping = hovered || focused || selected ? activeIconMapping : mutedIconMapping;
        if (state === "reviewed") {
          return <ThemedCircleCheck size={14} strokeWidth={2} uniProps={mapping} />;
        }
        if (state === "mixed") {
          return <ThemedCircleMinus size={14} strokeWidth={2} uniProps={mapping} />;
        }
        return <ThemedCircle size={14} strokeWidth={1.8} uniProps={mapping} />;
      }}
    </Pressable>
  );
});

const styles = StyleSheet.create(() => ({
  root: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
  pressed: { opacity: 0.7 },
}));
