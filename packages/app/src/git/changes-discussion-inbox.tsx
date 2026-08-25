import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MessageSquare, RefreshCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  describeChangesDiscussionState,
  isOpenChangesDiscussion,
  type ChangesDiscussionThread,
} from "@/git/changes-discussions";
import type { Theme } from "@/styles/theme";

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedRefreshCw = withUnistyles(RefreshCw);

export function ChangesDiscussionInbox(props: {
  visible: boolean;
  onClose: () => void;
  focusedThreadId: string | null;
  onShowAllThreads: () => void;
  threads: ChangesDiscussionThread[];
  truncated: boolean;
  mrUrl: string | null;
  isRefreshing: boolean;
  upgradeRequired: boolean;
  error: Error | null;
  onRefresh: () => void;
  onNavigate: (thread: ChangesDiscussionThread) => void;
  onReply: (threadId: string, body: string) => Promise<unknown>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const visibleThreads = useMemo(
    () =>
      props.focusedThreadId
        ? props.threads.filter((thread) => thread.id === props.focusedThreadId)
        : props.threads.filter((thread) => showResolved || isOpenChangesDiscussion(thread)),
    [props.focusedThreadId, props.threads, showResolved],
  );
  const openCount = props.threads.filter(isOpenChangesDiscussion).length;
  const showOpen = useCallback(() => setShowResolved(false), []);
  const showAll = useCallback(() => setShowResolved(true), []);
  const openMr = useCallback(() => {
    if (props.mrUrl) void openExternalUrl(props.mrUrl);
  }, [props.mrUrl]);
  const header = useMemo(
    () => ({
      title: "MR comments",
      subtitle: props.isRefreshing
        ? "Refreshing…"
        : `${openCount} open · ${props.threads.length} total`,
      leading: <ThemedMessageSquare size={18} uniProps={mutedIcon} />,
      actions: (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh GitLab comments"
          onPress={props.onRefresh}
          style={styles.iconButton}
        >
          <ThemedRefreshCw size={16} uniProps={mutedIcon} />
        </Pressable>
      ),
    }),
    [openCount, props.isRefreshing, props.onRefresh, props.threads.length],
  );
  return (
    <AdaptiveModalSheet
      visible={props.visible}
      onClose={props.onClose}
      header={header}
      desktopMaxWidth={680}
      testID="changes-discussion-inbox"
    >
      <View style={styles.filters}>
        {props.focusedThreadId ? (
          <Button size="sm" variant="ghost" onPress={props.onShowAllThreads}>
            Back to all comments
          </Button>
        ) : (
          <>
            <Button size="sm" variant={showResolved ? "ghost" : "secondary"} onPress={showOpen}>
              Open
            </Button>
            <Button size="sm" variant={showResolved ? "secondary" : "ghost"} onPress={showAll}>
              All
            </Button>
          </>
        )}
      </View>
      <InboxContent
        upgradeRequired={props.upgradeRequired}
        error={props.error}
        threads={visibleThreads}
        onNavigate={props.onNavigate}
        onReply={props.onReply}
      />
      {props.truncated ? (
        <Pressable onPress={openMr}>
          <Text style={styles.warning}>More discussions exist. Open the MR in GitLab.</Text>
        </Pressable>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function InboxContent(props: {
  upgradeRequired: boolean;
  error: Error | null;
  threads: ChangesDiscussionThread[];
  onNavigate: (thread: ChangesDiscussionThread) => void;
  onReply: (threadId: string, body: string) => Promise<unknown>;
}) {
  if (props.upgradeRequired) {
    return <Text style={styles.warning}>Update this host to load GitLab comments in Changes.</Text>;
  }
  if (props.error) return <Text style={styles.error}>{props.error.message}</Text>;
  if (props.threads.length === 0) {
    return <Text style={styles.empty}>No matching GitLab discussions.</Text>;
  }
  return props.threads.map((thread) => (
    <DiscussionCard
      key={thread.id}
      thread={thread}
      onNavigate={props.onNavigate}
      onReply={props.onReply}
    />
  ));
}

function DiscussionCard(props: {
  thread: ChangesDiscussionThread;
  onNavigate: (thread: ChangesDiscussionThread) => void;
  onReply: (threadId: string, body: string) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  const [replying, setReplying] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = props.thread.location;
  const locationLabel = location
    ? `${props.thread.displayPath ?? location.path}${location.line ? `:${location.line}` : ""}`
    : "General discussion";
  const submit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      if (!props.thread.discussionId) {
        throw new Error("This host did not provide a reply target for this discussion.");
      }
      await props.onReply(props.thread.discussionId, trimmed);
      setBody("");
      setResetRevision((value) => value + 1);
      setReplying(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }, [body, pending, props]);
  const navigate = useCallback(() => props.onNavigate(props.thread), [props]);
  const beginReply = useCallback(() => setReplying(true), []);
  const cancelReply = useCallback(() => setReplying(false), []);
  return (
    <View style={[styles.card, props.thread.placement === "stale" && styles.staleCard]}>
      <Pressable
        accessibilityRole="button"
        disabled={props.thread.placement === "unplaced"}
        onPress={navigate}
      >
        <Text style={styles.location}>{locationLabel}</Text>
        <Text style={styles.state}>{describeChangesDiscussionState(props.thread)}</Text>
      </Pressable>
      {props.thread.comments.map((comment) => (
        <DiscussionComment key={comment.id} comment={comment} />
      ))}
      {replying ? (
        <View style={styles.replyComposer}>
          <AdaptiveTextInput
            initialValue={body}
            resetKey={resetRevision}
            onChangeText={setBody}
            placeholder="Reply on GitLab…"
            multiline
            editable={!pending}
            autoFocus
            style={styles.replyInput}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.replyActions}>
            <Button size="sm" variant="ghost" onPress={cancelReply} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onPress={submit} disabled={!body.trim() || pending}>
              {pending ? "Sending…" : "Reply"}
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.replyActions}>
          <Button size="sm" variant="ghost" onPress={beginReply}>
            Reply
          </Button>
        </View>
      )}
    </View>
  );
}

function DiscussionComment({ comment }: { comment: ChangesDiscussionThread["comments"][number] }) {
  const openComment = useCallback(() => void openExternalUrl(comment.url), [comment.url]);
  return (
    <View style={styles.comment}>
      <View style={styles.commentHeader}>
        <Text numberOfLines={1} style={styles.author}>
          {comment.author}
        </Text>
        <Pressable onPress={openComment}>
          <Text style={styles.gitLabLink}>GitLab</Text>
        </Pressable>
      </View>
      <MarkdownRenderer text={comment.body} compact />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  filters: { flexDirection: "row", gap: theme.spacing[2] },
  iconButton: { padding: theme.spacing[2], borderRadius: theme.borderRadius.md },
  empty: { color: theme.colors.foregroundMuted, paddingVertical: theme.spacing[6] },
  warning: { color: theme.colors.statusWarning },
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  staleCard: { borderColor: theme.colors.statusWarning },
  location: { color: theme.colors.foreground, fontFamily: theme.fontFamily.mono },
  state: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  comment: { gap: theme.spacing[2] },
  commentHeader: { flexDirection: "row", justifyContent: "space-between", gap: theme.spacing[2] },
  author: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    flex: 1,
    minWidth: 0,
  },
  gitLabLink: { color: theme.colors.accent },
  replyInput: {
    minHeight: 84,
    color: theme.colors.foreground,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  replyComposer: { gap: theme.spacing[2] },
  replyActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
