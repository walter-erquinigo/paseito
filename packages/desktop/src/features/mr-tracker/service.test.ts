import { describe, expect, it } from "vitest";
import type { GitLabMergeRequest } from "./gitlab-client.js";
import { MRTrackerService, type GitLabTrackerClient } from "./service.js";
import type { MRTrackerStoreData } from "./store.js";
import {
  DEFAULT_MR_TRACKER_PERSISTED_STATE,
  DEFAULT_MR_TRACKER_SETTINGS,
  type MRTrackerNotification,
} from "./types.js";

const owner = { id: 7, name: "Octavia", username: "octavia", webUrl: null, avatarUrl: null };
const greptile = {
  id: 80,
  name: "Greptile",
  username: "group_bot",
  webUrl: null,
  avatarUrl: null,
};

function mergeRequest(iid: number): GitLabMergeRequest {
  return {
    iid,
    project_id: 10,
    title: `MR ${iid}`,
    description: "",
    state: "opened",
    source_branch: `feature-${iid}`,
    target_branch: "main",
    web_url: `https://gitlab.example.com/group/project/-/merge_requests/${iid}`,
    draft: false,
    author: { id: owner.id, name: owner.name, username: owner.username },
    reviewers: [],
    labels: [],
    detailed_merge_status: "mergeable",
    blocking_discussions_resolved: true,
  };
}

describe("MRTrackerService", () => {
  it("discovers owned MRs, keeps the first refresh silent, then reports transitions", async () => {
    let data: MRTrackerStoreData = {
      settings: {
        ...DEFAULT_MR_TRACKER_SETTINGS,
        gitLabBaseUrl: "https://gitlab.example.com",
        gitLabUsername: "octavia",
        activityUsers: [greptile],
      },
      state: structuredClone(DEFAULT_MR_TRACKER_PERSISTED_STATE),
    };
    const values = [mergeRequest(1)];
    let approvalsFail = false;
    let discussionsFail = false;
    const pipelineStatus = new Map<number, { id: number; status: string }>([
      [1, { id: 101, status: "success" }],
    ]);
    const notifications: MRTrackerNotification[] = [];
    const client: GitLabTrackerClient = {
      async currentUser() {
        return owner;
      },
      async exactUser(username) {
        return username === owner.username ? owner : null;
      },
      async user(userId) {
        if (userId === greptile.id) return greptile;
        throw new Error("not found");
      },
      async searchUsers() {
        return [greptile];
      },
      async openMergeRequestsByAuthor() {
        return values;
      },
      async openMergeRequestsByReviewer() {
        return [];
      },
      async mergeRequest(_projectRef, iid) {
        const value = values.find((entry) => entry.iid === iid);
        if (!value) throw new Error("not found");
        return value;
      },
      async latestPipeline(_projectRef, iid) {
        const value = pipelineStatus.get(iid);
        return value ? { ...value, webUrl: null, updatedAt: null } : null;
      },
      async approvals() {
        if (approvalsFail) throw new Error("temporary approvals failure");
        return {
          approvedBy: [],
          approvalsRequired: 0,
          approvalsLeft: 0,
          rulesLeft: 0,
          error: null,
        };
      },
      async discussions(_projectRef, _iid, activityOptions = {}) {
        if (discussionsFail) throw new Error("temporary discussions failure");
        return {
          unresolvedCount: 0,
          resolvableCount: 0,
          activity: (activityOptions.alwaysShowUsers ?? []).map((user) => ({
            user,
            noteCount: 1,
            unresolvedCount: 0,
          })),
          error: null,
        };
      },
    };
    const service = new MRTrackerService({
      store: {
        async load() {
          return structuredClone(data);
        },
        async save(next) {
          data = structuredClone(next);
        },
      },
      tokenStore: {
        async has() {
          return true;
        },
        async get() {
          return "secret";
        },
        async set() {},
        async clear() {},
      },
      createClient: () => client,
      onNotification: (notification) => notifications.push(notification),
      now: () => new Date("2026-08-20T20:00:00.000Z"),
    });

    const baseline = await service.refresh();
    expect(baseline.counts).toEqual({ all: 1, my_mrs: 1, others: 0 });
    expect(notifications).toEqual([]);

    approvalsFail = true;
    discussionsFail = true;
    const partial = await service.refresh();
    expect(partial.status).toBe("error");
    expect(partial.mergeRequests[0]?.approvals.approvalsLeft).toBe(0);
    expect(partial.mergeRequests[0]?.discussions.activity).toEqual([
      { user: greptile, noteCount: 1, unresolvedCount: 0 },
    ]);
    expect(notifications).toEqual([]);
    approvalsFail = false;
    discussionsFail = false;

    values.push(mergeRequest(2));
    pipelineStatus.set(2, { id: 201, status: "success" });
    await service.refresh();
    expect(notifications.map((value) => value.kind)).toEqual(["new_owned", "ready"]);

    notifications.length = 0;
    pipelineStatus.set(1, { id: 102, status: "failed" });
    await service.refresh();
    expect(notifications.map((value) => value.kind)).toEqual(["pipeline_failed"]);
  });

  it("resolves a GitLab URL, tracks a missing MR locally, and chooses its ownership tab", async () => {
    let data: MRTrackerStoreData = {
      settings: {
        ...DEFAULT_MR_TRACKER_SETTINGS,
        gitLabBaseUrl: "https://gitlab.example.com",
        gitLabUsername: "octavia",
      },
      state: structuredClone(DEFAULT_MR_TRACKER_PERSISTED_STATE),
    };
    const value = {
      ...mergeRequest(17),
      author: { id: 99, name: "Lin", username: "lin" },
    };
    const client: GitLabTrackerClient = {
      async currentUser() {
        return owner;
      },
      async exactUser(username) {
        return username === owner.username ? owner : null;
      },
      async user(userId) {
        if (userId === greptile.id) return greptile;
        throw new Error("not found");
      },
      async searchUsers() {
        return [greptile];
      },
      async openMergeRequestsByAuthor() {
        return [];
      },
      async openMergeRequestsByReviewer() {
        return [];
      },
      async mergeRequest() {
        return value;
      },
      async latestPipeline() {
        return null;
      },
      async approvals() {
        return {
          approvedBy: [],
          approvalsRequired: 0,
          approvalsLeft: 0,
          rulesLeft: 0,
          error: null,
        };
      },
      async discussions() {
        return { unresolvedCount: 0, resolvableCount: 0, activity: [], error: null };
      },
    };
    const service = new MRTrackerService({
      store: {
        async load() {
          return structuredClone(data);
        },
        async save(next) {
          data = structuredClone(next);
        },
      },
      tokenStore: {
        async has() {
          return true;
        },
        async get() {
          return "secret";
        },
        async set() {},
        async clear() {},
      },
      createClient: () => client,
    });

    await expect(service.resolveNavigation(`${value.web_url}?tab=notes#note_1`)).resolves.toEqual({
      mergeRequestId: "10:17",
      tab: "others",
    });
    expect(data.state.trackedItems).toHaveLength(1);
    await expect(
      service.resolveNavigation("https://other.example.com/group/project/-/merge_requests/17"),
    ).rejects.toThrow("not on the GitLab server configured in Paseito");
  });

  it("discovers commenter activity only on owned merge requests", async () => {
    let data: MRTrackerStoreData = {
      settings: {
        ...DEFAULT_MR_TRACKER_SETTINGS,
        gitLabBaseUrl: "https://gitlab.example.com",
        gitLabUsername: owner.username,
        activityUsers: [greptile],
        includeReviewerMergeRequests: true,
      },
      state: structuredClone(DEFAULT_MR_TRACKER_PERSISTED_STATE),
    };
    const owned = mergeRequest(1);
    const review = {
      ...mergeRequest(2),
      author: { id: 9, name: "Lin", username: "lin" },
    };
    const discussionActivityOptions: Array<{
      alwaysShowUserIds: number[];
      discoverAuthors: boolean;
      excludedUserIds: number[];
    }> = [];
    const client: GitLabTrackerClient = {
      async currentUser() {
        return owner;
      },
      async exactUser(username) {
        return username === owner.username ? owner : null;
      },
      async user(userId) {
        if (userId === greptile.id) return greptile;
        throw new Error("not found");
      },
      async searchUsers() {
        return [greptile];
      },
      async openMergeRequestsByAuthor() {
        return [owned];
      },
      async openMergeRequestsByReviewer() {
        return [review];
      },
      async mergeRequest(_projectRef, iid) {
        return iid === owned.iid ? owned : review;
      },
      async latestPipeline() {
        return { id: 1, status: "success", webUrl: null, updatedAt: null };
      },
      async approvals() {
        return {
          approvedBy: [],
          approvalsRequired: 0,
          approvalsLeft: 0,
          rulesLeft: 0,
          error: null,
        };
      },
      async discussions(_projectRef, _iid, activityOptions = {}) {
        discussionActivityOptions.push({
          alwaysShowUserIds: (activityOptions.alwaysShowUsers ?? []).map((user) => user.id),
          discoverAuthors: activityOptions.discoverAuthors === true,
          excludedUserIds: [...(activityOptions.excludedUserIds ?? [])],
        });
        return {
          unresolvedCount: 0,
          resolvableCount: 0,
          activity: (activityOptions.alwaysShowUsers ?? []).map((user) => ({
            user,
            noteCount: 1,
            unresolvedCount: 0,
          })),
          error: null,
        };
      },
    };
    const service = new MRTrackerService({
      store: {
        async load() {
          return structuredClone(data);
        },
        async save(next) {
          data = structuredClone(next);
        },
      },
      tokenStore: {
        async has() {
          return true;
        },
        async get() {
          return "secret";
        },
        async set() {},
        async clear() {},
      },
      createClient: () => client,
    });

    const state = await service.refresh();

    expect(discussionActivityOptions).toEqual([
      {
        alwaysShowUserIds: [greptile.id],
        discoverAuthors: true,
        excludedUserIds: [owner.id],
      },
      { alwaysShowUserIds: [], discoverAuthors: false, excludedUserIds: [] },
    ]);
    expect(state.mergeRequests.find((value) => value.iid === 1)?.discussions.activity).toEqual([
      { user: greptile, noteCount: 1, unresolvedCount: 0 },
    ]);
    expect(state.mergeRequests.find((value) => value.iid === 2)?.discussions.activity).toEqual([]);
  });
});
