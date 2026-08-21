import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react-native";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SearchField } from "@/components/ui/search-field";
import { openExternalUrl } from "@/utils/open-external-url";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { buildMRStacks, filterMRsByImportance } from "./model";
import { ImportanceControl } from "./importance-control";
import { useMRTrackerState } from "./client";
import type { MergeRequestSnapshot, MRImportance, MRTrackerTab } from "./types";

const TAB_TITLE_KEYS: Record<MRTrackerTab, string> = {
  all: "mrTracker.tabs.all",
  my_mrs: "mrTracker.tabs.myMRs",
  others: "mrTracker.tabs.others",
};

function emptyStateTitleKey(search: string, importantOnly: boolean): string {
  if (search) return "mrTracker.noMatches";
  if (importantOnly) return "mrTracker.noImportant";
  return "mrTracker.empty";
}

type BadgeTone = "muted" | "accent" | "success" | "danger";

function pipelineTone(status: string): BadgeTone {
  const normalized = status.toLowerCase();
  if (["failed", "canceled", "cancelled", "skipped"].includes(normalized)) return "danger";
  if (normalized === "success") return "success";
  if (["running", "pending", "created", "preparing", "waiting_for_resource"].includes(normalized)) {
    return "accent";
  }
  return "muted";
}

function approvalBadge(
  value: MergeRequestSnapshot,
  t: TFunction,
): { text: string; tone: BadgeTone } | null {
  const approvalsLeft = value.approvals.approvalsLeft;
  if (approvalsLeft !== null && approvalsLeft > 0) {
    return {
      text: t(approvalsLeft === 1 ? "mrTracker.approvalLeft" : "mrTracker.approvalsLeft", {
        count: approvalsLeft,
      }),
      tone: "danger",
    };
  }
  const approved = value.approvals.approvedBy.length;
  if (approved === 0) return null;
  return {
    text: t(approved === 1 ? "mrTracker.approvedSingular" : "mrTracker.approvedPlural", {
      count: approved,
    }),
    tone: "muted",
  };
}

export function MRTrackerScreen({ tab, focusId }: { tab: MRTrackerTab; focusId?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, isLoading, error, refresh, addTracked, removeTracked, setImportance } =
    useMRTrackerState();
  const [search, setSearch] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [trackPrompt, setTrackPrompt] = useState("");
  const [isTrackOpen, setIsTrackOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusId ? [focusId] : []));
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const trackInputRef = useRef<EditingTextInputHandle>(null);
  const visibleMergeRequests = useMemo(
    () => filterMRsByImportance(state?.mergeRequests ?? [], importantOnly),
    [importantOnly, state?.mergeRequests],
  );
  const stacks = useMemo(
    () => buildMRStacks(visibleMergeRequests, tab, search),
    [search, tab, visibleMergeRequests],
  );

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setPendingAction(id);
      setActionError(null);
      try {
        await action();
      } catch (value) {
        setActionError(value instanceof Error ? value.message : t("mrTracker.errors.actionFailed"));
      } finally {
        setPendingAction(null);
      }
    },
    [t],
  );

  const handleAdd = useCallback(async () => {
    const prompt = trackPrompt.trim();
    if (!prompt) return;
    await run("add", async () => {
      await addTracked(prompt);
      setTrackPrompt("");
      trackInputRef.current?.replaceText("");
      setIsTrackOpen(false);
    });
  }, [addTracked, run, trackPrompt]);
  const handleOpenTrack = useCallback(() => setIsTrackOpen(true), []);
  const handleToggleImportantOnly = useCallback(() => setImportantOnly((current) => !current), []);
  const handleCloseTrack = useCallback(() => {
    setTrackPrompt("");
    trackInputRef.current?.replaceText("");
    setIsTrackOpen(false);
  }, []);
  const handleRefresh = useCallback(() => void run("refresh", refresh), [refresh, run]);
  const handleOpenSettings = useCallback(
    () => router.push(buildSettingsSectionRoute("mrs")),
    [router],
  );
  const handleToggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleImportance = useCallback(
    (id: string, importance: MRImportance) => void run(id, () => setImportance(id, importance)),
    [run, setImportance],
  );
  const handleRemove = useCallback(
    (id: string) => void run(id, () => removeTracked(id)),
    [removeTracked, run],
  );
  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        {state?.lastUpdated ? (
          <Text style={styles.updated}>{formatUpdatedAt(state.lastUpdated, t)}</Text>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          leftIcon={RefreshCw}
          accessibilityLabel={t("mrTracker.refresh")}
          loading={state?.status === "refreshing"}
          disabled={!state?.hasToken}
          onPress={handleRefresh}
        />
      </View>
    ),
    [handleRefresh, state?.hasToken, state?.lastUpdated, state?.status, t],
  );

  let body;
  if (isLoading) {
    body = (
      <View style={styles.center}>
        <ThemedLoadingSpinner size="large" />
      </View>
    );
  } else if (!state?.hasToken) {
    body = (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t("mrTracker.unconfigured")}</Text>
        <Text style={styles.muted}>{t("mrTracker.unconfiguredHint")}</Text>
        <Button size="sm" onPress={handleOpenSettings}>
          {t("mrTracker.openSettings")}
        </Button>
      </View>
    );
  } else if (stacks.length === 0) {
    body = (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t(emptyStateTitleKey(search, importantOnly))}</Text>
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.list}>
        {stacks.map((stack) => (
          <View key={stack.id} style={styles.stackCard}>
            <View style={styles.stackHeader}>
              <ThemedGitPullRequest size={14} />
              <Text style={styles.stackTitle}>{stack.projectPath}</Text>
              <Text style={styles.stackCount}>
                {t(
                  stack.entries.length === 1
                    ? "mrTracker.mergeRequestCount"
                    : "mrTracker.mergeRequestCountPlural",
                  { count: stack.entries.length },
                )}
              </Text>
            </View>
            {stack.entries.map(({ mergeRequest, depth, context }) => (
              <MRRow
                key={mergeRequest.id}
                value={mergeRequest}
                depth={depth}
                context={context}
                expanded={expanded.has(mergeRequest.id)}
                pending={pendingAction === mergeRequest.id}
                onToggle={handleToggle}
                onImportance={handleImportance}
                onRemove={handleRemove}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader
        title={`${t("mrTracker.title")} · ${t(TAB_TITLE_KEYS[tab])}`}
        rightContent={headerActions}
      />
      {state?.hasToken ? (
        <View style={styles.toolbar}>
          <View style={styles.searchControls}>
            <View style={styles.searchField}>
              <SearchField
                value={search}
                onChangeText={setSearch}
                placeholder={t("mrTracker.search")}
                clearAccessibilityLabel={t("mrTracker.clearSearch")}
                testID="mr-tracker-search"
              />
            </View>
            <Button
              size="sm"
              variant={importantOnly ? "secondary" : "outline"}
              leftIcon={Star}
              accessibilityLabel={t("mrTracker.importantOnlyHint")}
              aria-pressed={importantOnly}
              onPress={handleToggleImportantOnly}
              testID="mr-tracker-important-only"
            >
              {t("mrTracker.importantOnly")}
            </Button>
          </View>
          {isTrackOpen ? (
            <View style={styles.trackField}>
              <ThemedTextInput
                ref={trackInputRef}
                initialValue={trackPrompt}
                onChangeText={setTrackPrompt}
                onSubmitEditing={handleAdd}
                placeholder={t("mrTracker.trackPlaceholder")}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.trackInput}
                testID="mr-tracker-add-input"
              />
              <Button
                size="sm"
                onPress={handleAdd}
                disabled={!trackPrompt.trim()}
                loading={pendingAction === "add"}
              >
                {t("mrTracker.add")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={X}
                accessibilityLabel={t("mrTracker.cancelTracking")}
                onPress={handleCloseTrack}
              />
            </View>
          ) : (
            <Button size="sm" variant="ghost" leftIcon={Plus} onPress={handleOpenTrack}>
              {t("mrTracker.trackMR")}
            </Button>
          )}
        </View>
      ) : null}
      {state?.errors.length ? (
        <View style={styles.errorBanner}>
          {state.errors.map((value) => (
            <Text key={value} style={styles.errorText}>
              {value}
            </Text>
          ))}
        </View>
      ) : null}
      {actionError || error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{actionError ?? error?.message}</Text>
        </View>
      ) : null}
      {body}
    </View>
  );
}

function MRRow({
  value,
  depth,
  context,
  expanded,
  pending,
  onToggle,
  onImportance,
  onRemove,
}: {
  value: MergeRequestSnapshot;
  depth: number;
  context: boolean;
  expanded: boolean;
  pending: boolean;
  onToggle: (id: string) => void;
  onImportance: (id: string, value: MRImportance) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(() => [styles.row, context && styles.contextRow], [context]);
  const rowContentStyle = useMemo(
    () => [styles.rowContent, { paddingLeft: themeSafeIndent(depth) }],
    [depth],
  );
  const [isSummaryHovered, setIsSummaryHovered] = useState(false);
  const [isSummaryFocused, setIsSummaryFocused] = useState(false);
  const handleTogglePressIn = useCallback(
    (event: GestureResponderEvent) => event.stopPropagation(),
    [],
  );
  const handleToggle = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggle(value.id);
    },
    [onToggle, value.id],
  );
  const handleImportance = useCallback(
    (importance: MRImportance) => onImportance(value.id, importance),
    [onImportance, value.id],
  );
  const handleRemove = useCallback(() => onRemove(value.id), [onRemove, value.id]);
  const handleOpen = useCallback(() => void openExternalUrl(value.webUrl), [value.webUrl]);
  const summaryStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.rowSummary,
      pressed && styles.rowSummaryPressed,
    ],
    [],
  );
  const handlePointerEnter = useCallback(() => setIsSummaryHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsSummaryHovered(false), []);
  const handleFocus = useCallback(() => setIsSummaryFocused(true), []);
  const handleBlur = useCallback(() => setIsSummaryFocused(false), []);
  const approval = approvalBadge(value, t);
  const showOpenCue = isSummaryHovered || isSummaryFocused;
  return (
    <View style={rowStyle}>
      {depth > 0 ? (
        <View style={[styles.stackRail, { left: themeSafeIndent(depth) - 20 }]} />
      ) : null}
      {value.needsAttention ? <View style={styles.attentionRail} /> : null}
      <View style={rowContentStyle}>
        <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
          <Pressable
            onPress={handleOpen}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={summaryStyle}
            accessibilityRole="button"
            accessibilityLabel={t("mrTracker.openInGitLabLabel", {
              iid: value.iid,
              title: value.title,
            })}
            accessibilityHint={t("mrTracker.openInGitLab")}
            testID={`mr-summary-${value.id}`}
          >
            <View style={styles.rowTopLine}>
              <Pressable
                onPressIn={handleTogglePressIn}
                onPress={handleToggle}
                style={styles.expandAction}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t(expanded ? "mrTracker.collapse" : "mrTracker.expand", {
                  title: value.title,
                })}
                testID={`mr-expand-${value.id}`}
              >
                {expanded ? <ThemedChevronDown size={14} /> : <ThemedChevronRight size={14} />}
              </Pressable>
              <Text style={styles.mrNumber}>!{value.iid}</Text>
              <Text style={styles.mrTitle} numberOfLines={expanded ? 2 : 1}>
                {value.title}
              </Text>
              <View
                style={[styles.openCue, showOpenCue && styles.openCueVisible]}
                pointerEvents="none"
                accessible={false}
                testID={`mr-open-cue-${value.id}`}
              >
                <ThemedExternalLink size={13} />
              </View>
              <View style={styles.rowTopSpacer} />
            </View>
            <View style={styles.rowMetaLine}>
              <View style={styles.authorAvatar}>
                <Text style={styles.authorInitial}>
                  {(value.author.name || value.author.username).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.authorName} numberOfLines={1}>
                {value.author.name || `@${value.author.username}`}
              </Text>
              <View style={styles.metaDivider} />
              <ImportanceControl
                value={value.importance}
                disabled={pending}
                onChange={handleImportance}
              />
              <View style={styles.badges}>
                {context ? <Badge text={t("mrTracker.context")} tone="muted" /> : null}
                {value.draft ? <Badge text={t("mrTracker.badges.draft")} tone="muted" /> : null}
                {value.isReviewer ? (
                  <Badge text={t("mrTracker.badges.reviewer")} tone="accent" />
                ) : null}
                {value.tracked ? (
                  <Badge text={t("mrTracker.badges.tracked")} tone="accent" />
                ) : null}
                {value.isReady ? <Badge text={t("mrTracker.badges.ready")} tone="success" /> : null}
                {value.hasMergeConflict ? (
                  <Badge text={t("mrTracker.badges.conflict")} tone="danger" />
                ) : null}
                {value.pipeline ? (
                  <Badge
                    text={humanizeStatus(value.pipeline.status)}
                    tone={pipelineTone(value.pipeline.status)}
                  />
                ) : null}
                {approval ? <Badge text={approval.text} tone={approval.tone} /> : null}
              </View>
            </View>
          </Pressable>
        </View>
        {expanded ? (
          <MRDetails
            value={value}
            pending={pending}
            onRemove={value.tracked ? handleRemove : undefined}
          />
        ) : null}
      </View>
    </View>
  );
}

function MRDetails({
  value,
  pending,
  onRemove,
}: {
  value: MergeRequestSnapshot;
  pending: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const people = (values: MergeRequestSnapshot["reviewers"]) =>
    values.length
      ? values.map((entry) => entry.name || entry.username).join(", ")
      : t("mrTracker.none");
  return (
    <View style={styles.details}>
      <View style={styles.branchLine}>
        <ThemedGitBranch size={14} />
        <Text style={styles.branchName} numberOfLines={1}>
          {value.sourceBranch}
        </Text>
        <Text style={styles.branchArrow}>→</Text>
        <Text style={styles.branchName} numberOfLines={1}>
          {value.targetBranch}
        </Text>
      </View>
      <View style={styles.detailsGrid}>
        <Detail label={t("mrTracker.details.assignees")} value={people(value.assignees)} />
        <Detail label={t("mrTracker.details.reviewers")} value={people(value.reviewers)} />
        <Detail
          label={t("mrTracker.details.approvedBy")}
          value={people(value.approvals.approvedBy)}
        />
        <Detail
          label={t("mrTracker.details.approvalsLeft")}
          value={value.approvals.error ?? String(value.approvals.approvalsLeft ?? "?")}
        />
        <Detail
          label={t("mrTracker.details.discussions")}
          value={value.discussions.error ?? String(value.discussions.unresolvedCount ?? "?")}
        />
        <Detail
          label={t("mrTracker.details.mergeStatus")}
          value={value.detailedMergeStatus ?? value.mergeStatus ?? t("mrTracker.none")}
        />
        {value.labels.length ? (
          <Detail label={t("mrTracker.details.labels")} value={value.labels.join(", ")} />
        ) : null}
      </View>
      {value.description ? <Text style={styles.description}>{value.description}</Text> : null}
      {onRemove ? (
        <View style={styles.detailsActions}>
          <Button size="xs" variant="ghost" leftIcon={Trash2} onPress={onRemove} disabled={pending}>
            {t("mrTracker.untrack")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone: BadgeTone }) {
  const badgeToneStyle = {
    muted: styles.mutedBadge,
    accent: styles.accentBadge,
    success: styles.successBadge,
    danger: styles.dangerBadge,
  }[tone];
  const dotToneStyle = {
    muted: styles.mutedBadgeDot,
    accent: styles.accentBadgeDot,
    success: styles.successBadgeDot,
    danger: styles.dangerBadgeDot,
  }[tone];
  const textToneStyle = {
    muted: styles.mutedBadgeText,
    accent: styles.accentBadgeText,
    success: styles.successBadgeText,
    danger: styles.dangerBadgeText,
  }[tone];
  return (
    <View style={[styles.badge, badgeToneStyle]}>
      <View style={[styles.badgeDot, dotToneStyle]} />
      <Text style={[styles.badgeText, textToneStyle]}>{text}</Text>
    </View>
  );
}

function themeSafeIndent(depth: number): number {
  return 12 + depth * 28;
}

function humanizeStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatUpdatedAt(value: string, t: TFunction): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("mrTracker.updatedNow");
  if (minutes < 60) return t("mrTracker.updatedMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mrTracker.updatedHours", { count: hours });
  return t("mrTracker.updatedDays", { count: Math.floor(hours / 24) });
}

const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedGitPullRequest = withUnistyles(GitPullRequest, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedGitBranch = withUnistyles(GitBranch, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedChevronDown = withUnistyles(ChevronDown, (theme) => ({
  color: theme.colors.foregroundExtraMuted,
}));
const ThemedChevronRight = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundExtraMuted,
}));
const ThemedExternalLink = withUnistyles(ExternalLink, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    alignItems: "center",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.borderAccent,
  },
  searchControls: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 360,
    maxWidth: 640,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  searchField: {
    flex: 1,
    minWidth: 180,
  },
  trackField: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "center",
    maxWidth: 720,
  },
  trackInput: {
    flex: 1,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    outlineWidth: 0,
  },
  errorBanner: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.statusDanger,
  },
  errorText: { color: theme.colors.statusDanger },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  muted: { color: theme.colors.foregroundMuted },
  list: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    paddingBottom: theme.spacing[12],
  },
  updated: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  stackCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  stackHeader: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  stackTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  stackCount: {
    marginLeft: "auto",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    position: "relative",
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  contextRow: { opacity: 0.72 },
  rowContent: {
    gap: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  stackRail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.colors.border,
  },
  attentionRail: {
    position: "absolute",
    left: 0,
    top: theme.spacing[2],
    bottom: theme.spacing[2],
    width: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusWarning,
  },
  rowTopLine: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  rowSummary: {
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[1],
  },
  rowSummaryPressed: {
    backgroundColor: theme.colors.surface2,
  },
  expandAction: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  mrNumber: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  mrTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  openCue: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
  },
  openCueVisible: {
    opacity: 1,
  },
  rowTopSpacer: { flex: 1 },
  rowMetaLine: {
    minHeight: 30,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingLeft: 23,
  },
  authorAvatar: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  authorInitial: {
    color: theme.colors.foregroundMuted,
    fontSize: 9,
    fontWeight: theme.fontWeight.semibold,
  },
  authorName: {
    maxWidth: 128,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  metaDivider: {
    width: 1,
    height: 12,
    backgroundColor: theme.colors.border,
  },
  badges: {
    flexShrink: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 14,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: theme.borderRadius.full,
  },
  mutedBadge: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  accentBadge: {
    backgroundColor: `${theme.colors.accent}14`,
    borderColor: `${theme.colors.accent}33`,
  },
  successBadge: {
    backgroundColor: `${theme.colors.statusSuccess}14`,
    borderColor: `${theme.colors.statusSuccess}33`,
  },
  dangerBadge: {
    backgroundColor: `${theme.colors.statusDanger}14`,
    borderColor: `${theme.colors.statusDanger}33`,
  },
  mutedBadgeText: { color: theme.colors.foregroundMuted },
  accentBadgeText: { color: theme.colors.accentBright },
  successBadgeText: { color: theme.colors.statusSuccess },
  dangerBadgeText: { color: theme.colors.statusDanger },
  mutedBadgeDot: { backgroundColor: theme.colors.foregroundExtraMuted },
  accentBadgeDot: { backgroundColor: theme.colors.accentBright },
  successBadgeDot: { backgroundColor: theme.colors.statusSuccess },
  dangerBadgeDot: { backgroundColor: theme.colors.statusDanger },
  rowActions: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  details: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    marginTop: theme.spacing[1],
    gap: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
  },
  branchLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  branchName: {
    maxWidth: 320,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  branchArrow: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  detailRow: {
    flexGrow: 1,
    flexBasis: 180,
    maxWidth: 300,
    gap: 2,
  },
  detailLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  detailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    paddingTop: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.borderAccent,
  },
  detailsActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
