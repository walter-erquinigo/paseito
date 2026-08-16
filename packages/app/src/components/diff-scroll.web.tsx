import { useCallback } from "react";
import { ScrollView, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";

interface DiffScrollProps {
  children: React.ReactNode;
  scrollViewWidth: number;
  onScrollViewWidthChange: (width: number) => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DiffScroll({
  children,
  onScrollViewWidthChange,
  style,
  contentContainerStyle,
  testID,
}: DiffScrollProps) {
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => onScrollViewWidthChange(e.nativeEvent.layout.width),
    [onScrollViewWidthChange],
  );

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={style}
      contentContainerStyle={contentContainerStyle}
      onLayout={handleLayout}
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}
