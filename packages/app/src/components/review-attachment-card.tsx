import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import {
  buildReviewAttachmentListItems,
  type ReviewAttachment,
} from "@/attachments/review-attachment-items";
import { AttachmentLabel } from "@/components/attachment-pill";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

export function ReviewAttachmentCard({ attachment }: { attachment: ReviewAttachment }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [expanded, setExpanded] = useState(false);
  const content = getAgentAttachmentPillContent(attachment, t);
  const items = useMemo(() => buildReviewAttachmentListItems(attachment), [attachment]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  const listStyle = useMemo(
    () => [styles.list, isCompact ? styles.listCompact : styles.listRegular],
    [isCompact],
  );

  return (
    <View testID="review-attachment-card" style={styles.frame}>
      <Pressable
        testID="review-attachment-toggle"
        onPress={toggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={`${content.title}, ${content.subtitle}`}
        accessibilityState={accessibilityState}
        aria-expanded={expanded}
        style={headerStyle}
      >
        <AttachmentLabel icon={content.icon} title={content.title} subtitle={content.subtitle} />
        <View style={styles.chevron}>
          {expanded ? (
            <ThemedChevronDown size={14} uniProps={iconForegroundMutedMapping} />
          ) : (
            <ThemedChevronRight size={14} uniProps={iconForegroundMutedMapping} />
          )}
        </View>
      </Pressable>
      {expanded ? (
        <ScrollView
          testID="review-attachment-list"
          style={listStyle}
          contentContainerStyle={styles.listContent}
          nestedScrollEnabled
        >
          {items.map((item) => (
            <View key={item.key} testID="review-attachment-item" style={styles.item}>
              <View style={styles.itemHeader}>
                <Text selectable style={styles.location}>
                  {item.location}
                </Text>
                {item.kind === "suggestion" ? (
                  <Text style={styles.kind}>{t("review.composer.codeChange")}</Text>
                ) : null}
              </View>
              {item.body ? (
                <Text selectable style={styles.body}>
                  {item.body}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function headerStyle({ hovered, pressed }: PressableStateCallbackType): StyleProp<ViewStyle> {
  return [styles.header, (hovered || pressed) && styles.headerActive];
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    maxWidth: "100%",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerActive: {
    backgroundColor: theme.colors.surface2,
  },
  chevron: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    maxHeight: 320,
    maxWidth: "100%",
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.borderAccent,
  },
  listCompact: {
    width: 280,
  },
  listRegular: {
    width: 440,
  },
  listContent: {
    paddingHorizontal: theme.spacing[3],
  },
  item: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.borderAccent,
  },
  itemHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  location: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  kind: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
}));
