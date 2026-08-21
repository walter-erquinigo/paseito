import {
  GitLabReadOnlyClient,
  projectPathFromMergeRequestUrl,
  type GitLabMergeRequest,
} from "./gitlab-client.js";
import { normalizeGitLabMergeRequestUrl } from "@getpaseo/protocol/mr-deep-link";
import type { MRTrackerStore, MRTrackerTokenStore } from "./store.js";
import {
  DEFAULT_MR_TRACKER_SETTINGS,
  type GitLabUserSummary,
  type MergeRequestApprovalSummary,
  type MergeRequestDiscussionSummary,
  type MergeRequestPipelineSummary,
  type MergeRequestSnapshot,
  type MRImportance,
  type MRTrackerNotification,
  type MRTrackerPersistedState,
  type MRTrackerSettings,
  type MRTrackerTab,
  type MRTrackerViewState,
  type TrackedMergeRequest,
} from "./types.js";

export interface MRTrackerNavigationResolution {
  mergeRequestId: string;
  tab: Exclude<MRTrackerTab, "all">;
}

export interface GitLabTrackerClient {
  currentUser(): Promise<GitLabUserSummary>;
  exactUser(username: string): Promise<GitLabUserSummary | null>;
  openMergeRequestsByAuthor(authorId: number): Promise<GitLabMergeRequest[]>;
  openMergeRequestsByReviewer(reviewerId: number): Promise<GitLabMergeRequest[]>;
  mergeRequest(projectRef: string | number, iid: number): Promise<GitLabMergeRequest>;
  latestPipeline(
    projectRef: string | number,
    iid: number,
  ): Promise<MergeRequestPipelineSummary | null>;
  approvals(projectRef: string | number, iid: number): Promise<MergeRequestApprovalSummary>;
  discussions(projectRef: string | number, iid: number): Promise<MergeRequestDiscussionSummary>;
}

export interface MRTrackerServiceOptions {
  store: MRTrackerStore;
  tokenStore: MRTrackerTokenStore;
  createClient?: (settings: MRTrackerSettings, token: string) => GitLabTrackerClient;
  onStateChanged?: (state: MRTrackerViewState) => void;
  onNotification?: (notification: MRTrackerNotification) => void;
  now?: () => Date;
}

interface Seed {
  id: string;
  projectRef: string | number;
  iid: number;
  sources: string[];
  tracked: boolean;
  summary: GitLabMergeRequest | null;
}

interface RefreshCollection {
  seeds: Seed[];
  errors: string[];
  complete: boolean;
}

function defaultClient(settings: MRTrackerSettings, token: string): GitLabTrackerClient {
  return new GitLabReadOnlyClient({
    baseUrl: settings.gitLabBaseUrl,
    token,
    tokenType: settings.tokenType,
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The GitLab operation failed.";
}

function normalizeNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeSettings(input: Partial<MRTrackerSettings>): MRTrackerSettings {
  return {
    gitLabBaseUrl: input.gitLabBaseUrl?.trim().replace(/\/+$/, "") ?? "",
    gitLabUsername: input.gitLabUsername?.trim() ?? "",
    authors: normalizeNames(input.authors ?? []),
    includeReviewerMergeRequests: input.includeReviewerMergeRequests !== false,
    tokenType: input.tokenType === "bearer" ? "bearer" : "private-token",
    refreshIntervalSeconds: 120,
  };
}

function emptyApprovals(error: string): MergeRequestApprovalSummary {
  return {
    approvedBy: [],
    approvalsRequired: null,
    approvalsLeft: null,
    rulesLeft: null,
    error,
  };
}

function emptyDiscussions(error: string): MergeRequestDiscussionSummary {
  return { unresolvedCount: null, resolvableCount: null, error };
}

function pipelineFromMergeRequest(value: GitLabMergeRequest): MergeRequestPipelineSummary | null {
  const pipeline = value.head_pipeline ?? value.pipeline;
  if (!pipeline?.status) return null;
  return {
    id: pipeline.id ?? null,
    status: pipeline.status,
    webUrl: pipeline.web_url ?? null,
    updatedAt: pipeline.updated_at ?? null,
  };
}

function resolvePipeline(
  result: PromiseSettledResult<MergeRequestPipelineSummary | null>,
  value: GitLabMergeRequest,
  previous: MergeRequestSnapshot | undefined,
  onPartialError: (area: string, error: unknown) => void,
): MergeRequestPipelineSummary | null {
  if (result.status === "fulfilled") return result.value ?? pipelineFromMergeRequest(value);
  onPartialError("pipeline", result.reason);
  return previous?.pipeline ?? pipelineFromMergeRequest(value);
}

function resolveApprovals(
  result: PromiseSettledResult<MergeRequestApprovalSummary>,
  previous: MergeRequestSnapshot | undefined,
  onPartialError: (area: string, error: unknown) => void,
): MergeRequestApprovalSummary {
  if (result.status === "fulfilled") return result.value;
  onPartialError("approvals", result.reason);
  return previous?.approvals ?? emptyApprovals(message(result.reason));
}

function resolveDiscussions(
  result: PromiseSettledResult<MergeRequestDiscussionSummary>,
  previous: MergeRequestSnapshot | undefined,
  onPartialError: (area: string, error: unknown) => void,
): MergeRequestDiscussionSummary {
  if (result.status === "fulfilled") return result.value;
  onPartialError("discussions", result.reason);
  return previous?.discussions ?? emptyDiscussions(message(result.reason));
}

function defaultImportance(seed: Seed): MRImportance {
  return seed.sources.includes("me") || seed.sources.includes("reviewer") || seed.tracked
    ? "important"
    : "ignored";
}

function needsAttention(input: {
  conflict: boolean;
  pipeline: MergeRequestPipelineSummary | null;
  approvals: MergeRequestApprovalSummary;
  discussions: MergeRequestDiscussionSummary;
}): boolean {
  return (
    input.conflict ||
    isPipelineFailed(input.pipeline) ||
    (input.approvals.approvalsLeft ?? 0) > 0 ||
    (input.discussions.unresolvedCount ?? 0) > 0
  );
}

function toUser(value: GitLabMergeRequest["author"]): GitLabUserSummary {
  return {
    id: value.id,
    name: value.name ?? null,
    username: value.username,
    webUrl: value.web_url ?? null,
    avatarUrl: value.avatar_url ?? null,
  };
}

function hasConflict(value: GitLabMergeRequest): boolean {
  return [value.merge_status, value.detailed_merge_status]
    .filter((status): status is string => typeof status === "string")
    .some((status) => {
      const normalized = status.toLowerCase();
      return normalized.includes("conflict") || normalized === "cannot_be_merged";
    });
}

function isPipelineSuccessful(pipeline: MergeRequestPipelineSummary | null): boolean {
  return pipeline?.status.toLowerCase() === "success";
}

function isPipelineFailed(pipeline: MergeRequestPipelineSummary | null): boolean {
  return ["failed", "canceled", "cancelled", "skipped"].includes(
    pipeline?.status.toLowerCase() ?? "",
  );
}

function isGitLabMergeable(value: GitLabMergeRequest): boolean {
  const status = value.detailed_merge_status?.toLowerCase() ?? value.merge_status?.toLowerCase();
  return status === "mergeable" || status === "can_be_merged" || status === "unchecked";
}

function computeReady(input: {
  value: GitLabMergeRequest;
  pipeline: MergeRequestPipelineSummary | null;
  approvals: MergeRequestApprovalSummary;
  conflict: boolean;
}): boolean {
  return (
    input.value.state === "opened" &&
    input.value.draft !== true &&
    input.value.work_in_progress !== true &&
    !input.conflict &&
    isGitLabMergeable(input.value) &&
    isPipelineSuccessful(input.pipeline) &&
    input.approvals.error === null &&
    input.approvals.approvalsLeft === 0 &&
    (input.value.blocking_discussions_resolved ?? true)
  );
}

function compareSnapshots(left: MergeRequestSnapshot, right: MergeRequestSnapshot): number {
  const importanceRank: Record<MRImportance, number> = {
    important: 0,
    ignored: 1,
  };
  return (
    importanceRank[left.importance] - importanceRank[right.importance] ||
    Number(right.needsAttention) - Number(left.needsAttention) ||
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
    left.projectPath.localeCompare(right.projectPath) ||
    left.iid - right.iid
  );
}

function parseTrackPrompt(prompt: string): { projectRef: string; iid: number } {
  const trimmed = prompt.trim();
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)(?:\/|$)/);
    if (match?.[1] && match[2]) {
      return { projectRef: decodeURIComponent(match[1]), iid: Number.parseInt(match[2], 10) };
    }
  } catch {
    // Fall through to namespace/project!123 syntax.
  }
  const shorthand = trimmed.match(/^(.+?)!(\d+)$/);
  if (!shorthand?.[1] || !shorthand[2]) {
    throw new Error("Paste a GitLab MR URL or enter namespace/project!123.");
  }
  return { projectRef: shorthand[1].trim(), iid: Number.parseInt(shorthand[2], 10) };
}

function counts(mergeRequests: MergeRequestSnapshot[]): MRTrackerViewState["counts"] {
  return {
    all: mergeRequests.length,
    my_mrs: mergeRequests.filter((value) => value.isOwned).length,
    others: mergeRequests.filter((value) => !value.isOwned).length,
  };
}

function requireConfiguredMergeRequestUrl(input: string, gitLabBaseUrl: string): string {
  const mergeRequestUrl = normalizeGitLabMergeRequestUrl(input);
  if (!mergeRequestUrl) {
    throw new Error("Open a valid HTTPS GitLab merge request URL.");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(gitLabBaseUrl);
  } catch {
    throw new Error("Configure the GitLab base URL first.");
  }
  const targetUrl = new URL(mergeRequestUrl);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  if (
    targetUrl.origin !== baseUrl.origin ||
    (basePath && targetUrl.pathname !== basePath && !targetUrl.pathname.startsWith(`${basePath}/`))
  ) {
    throw new Error("This merge request is not on the GitLab server configured in Paseito.");
  }
  return mergeRequestUrl;
}

export class MRTrackerService {
  private settings: MRTrackerSettings = { ...DEFAULT_MR_TRACKER_SETTINGS };
  private persistedState: MRTrackerPersistedState | null = null;
  private state: MRTrackerViewState = {
    status: "unconfigured",
    settings: { ...DEFAULT_MR_TRACKER_SETTINGS },
    hasToken: false,
    mergeRequests: [],
    lastUpdated: null,
    errors: [],
    counts: { all: 0, my_mrs: 0, others: 0 },
  };
  private started = false;
  private refreshPromise: Promise<MRTrackerViewState> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly createClient: NonNullable<MRTrackerServiceOptions["createClient"]>;
  private readonly now: () => Date;

  constructor(private readonly options: MRTrackerServiceOptions) {
    this.createClient = options.createClient ?? defaultClient;
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const data = await this.options.store.load();
    this.settings = normalizeSettings(data.settings);
    this.persistedState = data.state;
    const hasToken = await this.options.tokenStore.has();
    this.setState({
      status: hasToken && this.settings.gitLabBaseUrl ? "idle" : "unconfigured",
      settings: this.settings,
      hasToken,
      mergeRequests: data.state.snapshots,
      lastUpdated: data.state.lastUpdated,
      errors: [],
      counts: counts(data.state.snapshots),
    });
    this.installTimer();
    if (hasToken && this.settings.gitLabBaseUrl) void this.refresh();
  }

  async getState(): Promise<MRTrackerViewState> {
    await this.start();
    return structuredClone(this.state);
  }

  async saveSettings(input: Record<string, unknown>): Promise<MRTrackerViewState> {
    await this.start();
    const proposed = normalizeSettings({
      gitLabBaseUrl: typeof input.gitLabBaseUrl === "string" ? input.gitLabBaseUrl : "",
      gitLabUsername: typeof input.gitLabUsername === "string" ? input.gitLabUsername : "",
      authors: Array.isArray(input.authors)
        ? input.authors.filter((value): value is string => typeof value === "string")
        : [],
      includeReviewerMergeRequests: input.includeReviewerMergeRequests !== false,
      tokenType: input.tokenType === "bearer" ? "bearer" : "private-token",
    });
    const replacementToken = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
    const token = replacementToken || (await this.options.tokenStore.get());
    if (!token) throw new Error("Enter a GitLab access token.");
    const client = this.createClient(proposed, token);
    const actualUser = await client.currentUser();
    if (proposed.gitLabUsername) {
      const configuredUser = await client.exactUser(proposed.gitLabUsername);
      if (!configuredUser) throw new Error(`GitLab user ${proposed.gitLabUsername} was not found.`);
    } else {
      proposed.gitLabUsername = actualUser.username;
    }
    if (replacementToken) await this.options.tokenStore.set(replacementToken);
    this.settings = proposed;
    const persistedState = this.requirePersistedState();
    await this.options.store.save({ settings: this.settings, state: persistedState });
    this.setState({ ...this.state, settings: this.settings, hasToken: true, errors: [] });
    this.installTimer();
    return await this.refresh();
  }

  async clearToken(): Promise<MRTrackerViewState> {
    await this.start();
    await this.options.tokenStore.clear();
    this.setState({ ...this.state, status: "unconfigured", hasToken: false, errors: [] });
    return structuredClone(this.state);
  }

  async addTracked(prompt: string): Promise<MRTrackerViewState> {
    await this.start();
    const token = await this.requireToken();
    const parsed = parseTrackPrompt(prompt);
    const client = this.createClient(this.settings, token);
    const value = await client.mergeRequest(parsed.projectRef, parsed.iid);
    if (value.state !== "opened") throw new Error("Only open merge requests can be tracked.");
    const now = this.now().toISOString();
    const item: TrackedMergeRequest = {
      id: `${value.project_id}:${value.iid}`,
      projectRef: parsed.projectRef,
      projectId: value.project_id,
      projectPath: projectPathFromMergeRequestUrl(value.web_url),
      iid: value.iid,
      title: value.title,
      webUrl: value.web_url,
      sourcePrompt: prompt.trim(),
      addedAt: now,
      updatedAt: now,
    };
    const state = this.requirePersistedState();
    state.trackedItems = [...state.trackedItems.filter((entry) => entry.id !== item.id), item];
    state.importance[item.id] ??= "important";
    await this.options.store.save({ settings: this.settings, state });
    return await this.refresh();
  }

  async resolveNavigation(input: string): Promise<MRTrackerNavigationResolution> {
    await this.start();
    await this.requireToken();
    const mergeRequestUrl = requireConfiguredMergeRequestUrl(input, this.settings.gitLabBaseUrl);
    const findSnapshot = (state: MRTrackerViewState) =>
      state.mergeRequests.find(
        (entry) => normalizeGitLabMergeRequestUrl(entry.webUrl) === mergeRequestUrl,
      );

    let snapshot = findSnapshot(this.state);
    if (!snapshot) {
      let state = await this.addTracked(mergeRequestUrl);
      snapshot = findSnapshot(state);
      if (!snapshot) {
        state = await this.refresh();
        snapshot = findSnapshot(state);
      }
    }
    if (!snapshot) {
      throw new Error("Paseito could not load this merge request from GitLab.");
    }
    return {
      mergeRequestId: snapshot.id,
      tab: snapshot.isOwned ? "my_mrs" : "others",
    };
  }

  async removeTracked(id: string): Promise<MRTrackerViewState> {
    await this.start();
    const state = this.requirePersistedState();
    state.trackedItems = state.trackedItems.filter((entry) => entry.id !== id);
    await this.options.store.save({ settings: this.settings, state });
    return await this.refresh();
  }

  async setImportance(id: string, importance: MRImportance): Promise<MRTrackerViewState> {
    await this.start();
    if (!["important", "ignored"].includes(importance)) {
      throw new Error("Unsupported importance value.");
    }
    const state = this.requirePersistedState();
    state.importance[id] = importance;
    state.snapshots = state.snapshots
      .map((entry) => (entry.id === id ? { ...entry, importance } : entry))
      .sort(compareSnapshots);
    await this.options.store.save({ settings: this.settings, state });
    this.setState({
      ...this.state,
      mergeRequests: state.snapshots,
      counts: counts(state.snapshots),
    });
    return structuredClone(this.state);
  }

  async refresh(): Promise<MRTrackerViewState> {
    await this.start();
    if (this.refreshPromise) return await this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return await this.refreshPromise;
  }

  private async performRefresh(): Promise<MRTrackerViewState> {
    let token: string;
    try {
      token = await this.requireToken();
    } catch (error) {
      this.setState({
        ...this.state,
        status: "unconfigured",
        hasToken: false,
        errors: [message(error)],
      });
      return structuredClone(this.state);
    }
    this.setState({ ...this.state, status: "refreshing", errors: [] });
    try {
      const client = this.createClient(this.settings, token);
      const actualUser = await client.currentUser();
      const owner = this.settings.gitLabUsername
        ? await client.exactUser(this.settings.gitLabUsername)
        : actualUser;
      if (!owner) throw new Error(`GitLab user ${this.settings.gitLabUsername} was not found.`);
      const collection = await this.collectSeeds(client, owner);
      const previousById = new Map(
        this.requirePersistedState().snapshots.map((value) => [value.id, value]),
      );
      const snapshots: MergeRequestSnapshot[] = [];
      const terminalIds = new Set<string>();
      for (let start = 0; start < collection.seeds.length; start += 4) {
        const batch = collection.seeds.slice(start, start + 4);
        const values = await Promise.all(
          batch.map(async (seed) => {
            try {
              const value = await this.hydrate(
                seed,
                client,
                previousById.get(seed.id),
                (area, error) => {
                  collection.complete = false;
                  collection.errors.push(`${seed.id} ${area}: ${message(error)}`);
                },
              );
              if (!value) terminalIds.add(seed.id);
              return value;
            } catch (error) {
              collection.complete = false;
              collection.errors.push(`${seed.id}: ${message(error)}`);
              return previousById.get(seed.id) ?? null;
            }
          }),
        );
        snapshots.push(...values.filter((value): value is MergeRequestSnapshot => value !== null));
      }
      if (!collection.complete) {
        const present = new Set(snapshots.map((value) => value.id));
        for (const previous of previousById.values()) {
          if (!present.has(previous.id)) snapshots.push(previous);
        }
      }
      const state = this.requirePersistedState();
      state.trackedItems = state.trackedItems.filter((item) => !terminalIds.has(item.id));
      const uniqueSnapshots = Array.from(
        new Map(snapshots.map((snapshot) => [snapshot.id, snapshot])).values(),
      ).sort(compareSnapshots);
      const notifications = this.updateNotificationState(
        uniqueSnapshots,
        state,
        collection.complete,
      );
      state.snapshots = uniqueSnapshots;
      state.lastUpdated = this.now().toISOString();
      await this.options.store.save({ settings: this.settings, state });
      this.setState({
        status: collection.errors.length > 0 ? "error" : "ready",
        settings: this.settings,
        hasToken: true,
        mergeRequests: uniqueSnapshots,
        lastUpdated: state.lastUpdated,
        errors: collection.errors,
        counts: counts(uniqueSnapshots),
      });
      for (const notification of notifications) this.options.onNotification?.(notification);
    } catch (error) {
      this.setState({ ...this.state, status: "error", errors: [message(error)] });
    }
    return structuredClone(this.state);
  }

  private async collectSeeds(
    client: GitLabTrackerClient,
    owner: GitLabUserSummary,
  ): Promise<RefreshCollection> {
    const seeds = new Map<string, Seed>();
    const errors: string[] = [];
    let complete = true;
    const add = (value: GitLabMergeRequest, source: string) => {
      const id = `${value.project_id}:${value.iid}`;
      const existing = seeds.get(id);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        return;
      }
      seeds.set(id, {
        id,
        projectRef: value.project_id,
        iid: value.iid,
        sources: [source],
        tracked: false,
        summary: value,
      });
    };
    const authors: Array<{ user: GitLabUserSummary; source: string }> = [
      { user: owner, source: "me" },
    ];
    for (const username of this.settings.authors) {
      if (username.toLowerCase() === owner.username.toLowerCase()) continue;
      try {
        const user = await client.exactUser(username);
        if (!user) {
          complete = false;
          errors.push(`${username}: GitLab user not found.`);
        } else {
          authors.push({ user, source: username });
        }
      } catch (error) {
        complete = false;
        errors.push(`${username}: ${message(error)}`);
      }
    }
    for (const author of authors) {
      try {
        for (const value of await client.openMergeRequestsByAuthor(author.user.id)) {
          add(value, author.source);
        }
      } catch (error) {
        complete = false;
        errors.push(`${author.user.username}: ${message(error)}`);
      }
    }
    if (this.settings.includeReviewerMergeRequests) {
      try {
        for (const value of await client.openMergeRequestsByReviewer(owner.id))
          add(value, "reviewer");
      } catch (error) {
        complete = false;
        errors.push(`Reviewer MRs for ${owner.username}: ${message(error)}`);
      }
    }
    for (const tracked of this.requirePersistedState().trackedItems) {
      const existing = seeds.get(tracked.id);
      if (existing) {
        existing.tracked = true;
        if (!existing.sources.includes("tracked")) existing.sources.push("tracked");
      } else {
        seeds.set(tracked.id, {
          id: tracked.id,
          projectRef: tracked.projectRef,
          iid: tracked.iid,
          sources: ["tracked"],
          tracked: true,
          summary: null,
        });
      }
    }
    return { seeds: [...seeds.values()], errors, complete };
  }

  private async hydrate(
    seed: Seed,
    client: GitLabTrackerClient,
    previous: MergeRequestSnapshot | undefined,
    onPartialError: (area: string, error: unknown) => void,
  ): Promise<MergeRequestSnapshot | null> {
    const value = await client.mergeRequest(seed.projectRef, seed.iid);
    if (value.state !== "opened") return null;
    const [pipelineResult, approvalResult, discussionResult] = await Promise.allSettled([
      client.latestPipeline(value.project_id, value.iid),
      client.approvals(value.project_id, value.iid),
      client.discussions(value.project_id, value.iid),
    ]);
    const pipeline = resolvePipeline(pipelineResult, value, previous, onPartialError);
    const approvals = resolveApprovals(approvalResult, previous, onPartialError);
    const discussions = resolveDiscussions(discussionResult, previous, onPartialError);
    const conflict = hasConflict(value);
    const ready = computeReady({ value, pipeline, approvals, conflict });
    const id = `${value.project_id}:${value.iid}`;
    const savedImportance = this.requirePersistedState().importance[id];
    const assignees = value.assignees ?? (value.assignee ? [value.assignee] : []);
    return {
      id,
      projectId: value.project_id,
      projectPath: projectPathFromMergeRequestUrl(value.web_url),
      iid: value.iid,
      title: value.title,
      description: value.description ?? "",
      webUrl: value.web_url,
      state: value.state,
      sourceBranch: value.source_branch ?? "",
      targetBranch: value.target_branch,
      sourceSha: value.sha ?? value.diff_refs?.head_sha ?? "",
      createdAt: value.created_at ?? null,
      updatedAt: value.updated_at ?? null,
      draft: value.draft === true || value.work_in_progress === true,
      author: toUser(value.author),
      assignees: assignees.map(toUser),
      reviewers: (value.reviewers ?? []).map(toUser),
      labels: value.labels ?? [],
      pipeline,
      approvals,
      discussions,
      mergeStatus: value.merge_status ?? null,
      detailedMergeStatus: value.detailed_merge_status ?? null,
      blockingDiscussionsResolved: value.blocking_discussions_resolved ?? null,
      sources: seed.sources,
      tracked: seed.tracked,
      importance: savedImportance ?? defaultImportance(seed),
      isOwned: seed.sources.includes("me"),
      isReviewer: seed.sources.includes("reviewer"),
      hasMergeConflict: conflict,
      isReady: ready,
      needsAttention: needsAttention({ conflict, pipeline, approvals, discussions }),
    };
  }

  private updateNotificationState(
    snapshots: MergeRequestSnapshot[],
    state: MRTrackerPersistedState,
    complete: boolean,
  ): MRTrackerNotification[] {
    if (!complete) return [];
    const notifications: MRTrackerNotification[] = [];
    const previousOwned = new Set(state.previousOwnedIds);
    if (state.baselineEstablished) {
      for (const snapshot of snapshots) {
        if (snapshot.isOwned && !previousOwned.has(snapshot.id)) {
          notifications.push({
            kind: "new_owned",
            mergeRequestId: snapshot.id,
            title: `New MR from ${snapshot.author.name || snapshot.author.username}`,
            body: `!${snapshot.iid} ${snapshot.title}`,
            webUrl: snapshot.webUrl,
          });
        }
        if (snapshot.isOwned && snapshot.isReady && state.readinessById[snapshot.id] !== true) {
          notifications.push({
            kind: "ready",
            mergeRequestId: snapshot.id,
            title: `MR !${snapshot.iid} is ready`,
            body: snapshot.title,
            webUrl: snapshot.webUrl,
          });
        }
        if (
          snapshot.isOwned &&
          isPipelineFailed(snapshot.pipeline) &&
          snapshot.pipeline?.id !== null &&
          snapshot.pipeline?.id !== undefined &&
          state.failedPipelineIdByMrId[snapshot.id] !== snapshot.pipeline.id
        ) {
          notifications.push({
            kind: "pipeline_failed",
            mergeRequestId: snapshot.id,
            title: `Pipeline failed for !${snapshot.iid}`,
            body: snapshot.title,
            webUrl: snapshot.webUrl,
          });
          state.failedPipelineIdByMrId[snapshot.id] = snapshot.pipeline.id;
        }
      }
    } else {
      state.baselineEstablished = true;
    }
    state.previousOwnedIds = snapshots.filter((value) => value.isOwned).map((value) => value.id);
    state.readinessById = Object.fromEntries(snapshots.map((value) => [value.id, value.isReady]));
    return notifications;
  }

  private async requireToken(): Promise<string> {
    if (!this.settings.gitLabBaseUrl) throw new Error("Configure the GitLab base URL first.");
    const token = await this.options.tokenStore.get();
    if (!token) throw new Error("Enter a GitLab access token.");
    return token;
  }

  private requirePersistedState(): MRTrackerPersistedState {
    if (!this.persistedState) throw new Error("MR tracker has not started.");
    return this.persistedState;
  }

  private installTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.state.hasToken && this.settings.gitLabBaseUrl) void this.refresh();
    }, 120_000);
    this.timer.unref?.();
  }

  private setState(state: MRTrackerViewState): void {
    this.state = structuredClone(state);
    this.options.onStateChanged?.(structuredClone(this.state));
  }
}
