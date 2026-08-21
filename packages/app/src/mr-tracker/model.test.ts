import { describe, expect, it } from "vitest";
import type { MergeRequestSnapshot } from "./types";
import { buildMRStacks, filterMRsByImportance } from "./model";

function snapshot(
  id: string,
  iid: number,
  sourceBranch: string,
  targetBranch: string,
  isOwned: boolean,
): MergeRequestSnapshot {
  return {
    id,
    projectId: 10,
    projectPath: "group/project",
    iid,
    title: `MR ${iid}`,
    description: "",
    webUrl: `https://gitlab.example.com/group/project/-/merge_requests/${iid}`,
    state: "opened",
    sourceBranch,
    targetBranch,
    sourceSha: "abc",
    createdAt: null,
    updatedAt: `2026-08-${iid.toString().padStart(2, "0")}`,
    draft: false,
    author: { id: 1, name: "Octavia", username: "octavia", webUrl: null, avatarUrl: null },
    assignees: [],
    reviewers: [],
    labels: [],
    pipeline: null,
    approvals: {
      approvedBy: [],
      approvalsRequired: null,
      approvalsLeft: null,
      rulesLeft: null,
      error: null,
    },
    discussions: { unresolvedCount: 0, resolvableCount: 0, activity: [], error: null },
    mergeStatus: "can_be_merged",
    detailedMergeStatus: "mergeable",
    blockingDiscussionsResolved: true,
    sources: isOwned ? ["me"] : ["reviewer"],
    tracked: false,
    importance: "ignored",
    isOwned,
    isReviewer: !isOwned,
    hasMergeConflict: false,
    isReady: false,
    needsAttention: false,
  };
}

describe("buildMRStacks", () => {
  it("retains non-tab ancestors as stack context", () => {
    const parent = snapshot("10:1", 1, "feature-base", "main", false);
    const child = snapshot("10:2", 2, "feature-child", "feature-base", true);

    const stacks = buildMRStacks([child, parent], "my_mrs", "");

    expect(stacks).toHaveLength(1);
    expect(
      stacks[0]?.entries.map((entry) => [entry.mergeRequest.id, entry.depth, entry.context]),
    ).toEqual([
      ["10:1", 0, true],
      ["10:2", 1, false],
    ]);
  });
});

describe("filterMRsByImportance", () => {
  it("keeps only Important MRs when the toolbar filter is active", () => {
    const important = {
      ...snapshot("10:1", 1, "important", "main", true),
      importance: "important" as const,
    };
    const ignored = snapshot("10:2", 2, "ignored", "main", true);

    expect(filterMRsByImportance([important, ignored], true)).toEqual([important]);
    expect(filterMRsByImportance([important, ignored], false)).toEqual([important, ignored]);
  });
});
