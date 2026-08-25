import type {
  ParsedDiffFile,
  PullRequestTimelineResponse,
  SubscribeCheckoutDiffResponse,
} from "@getpaseo/protocol/messages";
import { buildNumberedDiffHunks, buildReviewableDiffTargetKey } from "@/utils/diff-layout";

type TimelineItem = PullRequestTimelineResponse["payload"]["items"][number];
export type ChangesDiscussionComment = Extract<TimelineItem, { kind: "comment" }>;
export type ChangesComparisonIdentity = NonNullable<
  SubscribeCheckoutDiffResponse["payload"]["comparisonIdentity"]
>;

export interface ChangesDiscussionThread {
  id: string;
  discussionId?: string;
  comments: ChangesDiscussionComment[];
  location?: ChangesDiscussionComment["location"];
  isResolved?: boolean;
  placement: "exact" | "stale" | "unplaced";
  targetKey?: string;
  targetPath?: string;
  displayPath?: string;
}

export function isOpenChangesDiscussion(thread: ChangesDiscussionThread): boolean {
  return thread.isResolved !== true;
}

export function describeChangesDiscussionState(thread: ChangesDiscussionThread): string {
  let state = "Comment";
  if (thread.isResolved === true) state = "Resolved";
  else if (thread.isResolved === false) state = "Unresolved";

  let placement: string | null = null;
  if (thread.placement === "stale") placement = "Position may be stale";
  else if (thread.location && thread.placement === "unplaced") {
    placement = "Not present in this comparison";
  }
  return placement ? `${state} · ${placement}` : state;
}

function threadId(comment: ChangesDiscussionComment): string {
  return comment.threadId ?? comment.location?.threadId ?? `note:${comment.id}`;
}

function isExactRevision(
  location: NonNullable<ChangesDiscussionComment["location"]>,
  comparison: ChangesComparisonIdentity | undefined,
): boolean {
  return Boolean(
    location.position &&
    comparison?.kind === "commit_range" &&
    location.position.baseSha === comparison.baseSha &&
    location.position.headSha === comparison.headSha,
  );
}

function collectTargetKeys(files: readonly ParsedDiffFile[]): {
  keys: Set<string>;
  oldPathToCurrentPath: Map<string, string>;
} {
  const keys = new Set<string>();
  const oldPathToCurrentPath = new Map<string, string>();
  for (const file of files) {
    if (file.oldPath) oldPathToCurrentPath.set(file.oldPath, file.path);
    for (const hunk of buildNumberedDiffHunks(file)) {
      for (const line of hunk.lines) {
        if (line.oldCell) keys.add(line.oldCell.key);
        if (line.newCell) keys.add(line.newCell.key);
      }
    }
  }
  return { keys, oldPathToCurrentPath };
}

export function buildChangesDiscussionThreads(input: {
  items: readonly TimelineItem[];
  files: readonly ParsedDiffFile[];
  comparisonIdentity?: ChangesComparisonIdentity;
}): ChangesDiscussionThread[] {
  const grouped = new Map<string, ChangesDiscussionComment[]>();
  for (const item of input.items) {
    if (item.kind !== "comment") continue;
    const id = threadId(item);
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }

  const { keys, oldPathToCurrentPath } = collectTargetKeys(input.files);
  return [...grouped.entries()].map(([id, comments]) => {
    const discussionId = comments.find((comment) => comment.discussionId)?.discussionId;
    const location = comments.find((comment) => comment.location)?.location;
    const isResolved =
      comments.find((comment) => comment.location?.isResolved !== undefined)?.location
        ?.isResolved ??
      comments.find((comment) => comment.threadIsResolved !== undefined)?.threadIsResolved;
    if (!location?.line) {
      return { id, discussionId, comments, location, isResolved, placement: "unplaced" };
    }
    const side = location.side ?? "new";
    const currentPath =
      side === "old" ? (oldPathToCurrentPath.get(location.path) ?? location.path) : location.path;
    const targetKey = buildReviewableDiffTargetKey({
      filePath: currentPath,
      side,
      lineNumber: location.line,
    });
    if (!keys.has(targetKey)) {
      return {
        id,
        discussionId,
        comments,
        location,
        isResolved,
        placement: "unplaced",
        displayPath: location.path,
      };
    }
    return {
      id,
      discussionId,
      comments,
      location,
      isResolved,
      placement: isExactRevision(location, input.comparisonIdentity) ? "exact" : "stale",
      targetKey,
      targetPath: currentPath,
      displayPath: location.path,
    };
  });
}

export function groupChangesDiscussionsByTarget(
  threads: readonly ChangesDiscussionThread[],
): Map<string, ChangesDiscussionThread[]> {
  const result = new Map<string, ChangesDiscussionThread[]>();
  for (const thread of threads) {
    if (!thread.targetKey) continue;
    result.set(thread.targetKey, [...(result.get(thread.targetKey) ?? []), thread]);
  }
  return result;
}
