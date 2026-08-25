import { describe, expect, it } from "vitest";
import type { ParsedDiffFile, PullRequestTimelineItem } from "@getpaseo/protocol/messages";
import {
  buildChangesDiscussionThreads,
  describeChangesDiscussionState,
  isOpenChangesDiscussion,
} from "./changes-discussions";

const file: ParsedDiffFile = {
  path: "src/new.ts",
  oldPath: "src/old.ts",
  isNew: false,
  isDeleted: false,
  additions: 1,
  deletions: 1,
  hunks: [
    {
      oldStart: 4,
      oldCount: 1,
      newStart: 4,
      newCount: 1,
      lines: [
        { type: "remove", content: "-before" },
        { type: "add", content: "+after" },
      ],
    },
  ],
};

function comment(
  id: string,
  location?: Extract<PullRequestTimelineItem, { kind: "comment" }>["location"],
): PullRequestTimelineItem {
  return {
    id,
    kind: "comment",
    author: "reviewer",
    body: "Please revisit this.",
    createdAt: 1,
    url: `https://gitlab.example/note_${id}`,
    threadId: "discussion-1",
    location,
  };
}

describe("buildChangesDiscussionThreads", () => {
  it("places exact new-side discussions only when both comparison SHAs match", () => {
    const threads = buildChangesDiscussionThreads({
      items: [
        comment("1", {
          path: "src/new.ts",
          side: "new",
          line: 4,
          position: { baseSha: "base", startSha: "start", headSha: "head" },
        }),
      ],
      files: [file],
      comparisonIdentity: { kind: "commit_range", baseSha: "base", headSha: "head" },
    });

    expect(threads[0]).toMatchObject({
      placement: "exact",
      targetKey: "src/new.ts:new:4",
    });
  });

  it("marks a placeable SHA mismatch stale and maps renamed old paths", () => {
    const threads = buildChangesDiscussionThreads({
      items: [
        comment("1", {
          path: "src/old.ts",
          side: "old",
          line: 4,
          position: { baseSha: "old-base", startSha: "start", headSha: "old-head" },
        }),
      ],
      files: [file],
      comparisonIdentity: { kind: "commit_range", baseSha: "base", headSha: "head" },
    });

    expect(threads[0]).toMatchObject({
      placement: "stale",
      targetKey: "src/new.ts:old:4",
      targetPath: "src/new.ts",
      displayPath: "src/old.ts",
    });
  });

  it("keeps general and missing-line discussions in the inbox", () => {
    const general = comment("1");
    const missing = {
      ...comment("2", { path: "missing.ts", side: "new", line: 9 }),
      threadId: "discussion-2",
    };
    const threads = buildChangesDiscussionThreads({ items: [general, missing], files: [file] });
    expect(threads.map((thread) => thread.placement)).toEqual(["unplaced", "unplaced"]);
  });
});

describe("discussion presentation", () => {
  it("does not describe an ordinary general note as unresolved or missing", () => {
    const [thread] = buildChangesDiscussionThreads({
      items: [comment("1")],
      files: [file],
    });

    expect(thread).toBeDefined();
    expect(describeChangesDiscussionState(thread!)).toBe("Comment");
    expect(isOpenChangesDiscussion(thread!)).toBe(true);
  });

  it("keeps resolution and positioned-placement states distinct", () => {
    const thread = {
      id: "discussion-2",
      comments: [],
      location: { path: "missing.ts", line: 9, side: "new" as const },
      isResolved: false,
      placement: "unplaced" as const,
    };

    expect(describeChangesDiscussionState(thread)).toBe(
      "Unresolved · Not present in this comparison",
    );
    expect(isOpenChangesDiscussion({ ...thread, isResolved: true })).toBe(false);
  });
});
