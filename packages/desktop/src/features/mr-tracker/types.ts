export type MRTrackerTokenType = "private-token" | "bearer";
export type MRImportance = "important" | "ignored";
export type MRTrackerTab = "all" | "my_mrs" | "others";
import type { MRAutomationViewState } from "./automation-types.js";

export interface MRTrackerSettings {
  gitLabBaseUrl: string;
  gitLabUsername: string;
  authors: string[];
  activityUsers: GitLabUserSummary[];
  includeReviewerMergeRequests: boolean;
  tokenType: MRTrackerTokenType;
  refreshIntervalSeconds: 120;
}

export interface GitLabUserSummary {
  id: number;
  name: string | null;
  username: string;
  webUrl: string | null;
  avatarUrl: string | null;
}

export interface MergeRequestPipelineSummary {
  id: number | null;
  status: string;
  webUrl: string | null;
  updatedAt: string | null;
}

export interface MergeRequestApprovalSummary {
  approvedBy: GitLabUserSummary[];
  approvalsRequired: number | null;
  approvalsLeft: number | null;
  rulesLeft: number | null;
  error: string | null;
}

export interface MergeRequestDiscussionSummary {
  unresolvedCount: number | null;
  resolvableCount: number | null;
  activity: MergeRequestUserActivitySummary[];
  error: string | null;
}

export interface MergeRequestUserActivitySummary {
  user: GitLabUserSummary;
  noteCount: number;
  unresolvedCount: number;
}

export interface MergeRequestSnapshot {
  id: string;
  projectId: number;
  projectPath: string;
  iid: number;
  title: string;
  description: string;
  webUrl: string;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  sourceSha: string;
  createdAt: string | null;
  updatedAt: string | null;
  draft: boolean;
  author: GitLabUserSummary;
  assignees: GitLabUserSummary[];
  reviewers: GitLabUserSummary[];
  labels: string[];
  pipeline: MergeRequestPipelineSummary | null;
  approvals: MergeRequestApprovalSummary;
  discussions: MergeRequestDiscussionSummary;
  mergeStatus: string | null;
  detailedMergeStatus: string | null;
  blockingDiscussionsResolved: boolean | null;
  sources: string[];
  tracked: boolean;
  importance: MRImportance;
  isOwned: boolean;
  isReviewer: boolean;
  hasMergeConflict: boolean;
  isReady: boolean;
  needsAttention: boolean;
}

export interface TrackedMergeRequest {
  id: string;
  projectRef: string;
  projectId: number;
  projectPath: string;
  iid: number;
  title: string;
  webUrl: string;
  sourcePrompt: string;
  addedAt: string;
  updatedAt: string;
}

export interface MRTrackerPersistedState {
  trackedItems: TrackedMergeRequest[];
  importance: Record<string, MRImportance>;
  baselineEstablished: boolean;
  previousOwnedIds: string[];
  readinessById: Record<string, boolean>;
  failedPipelineIdByMrId: Record<string, number>;
  snapshots: MergeRequestSnapshot[];
  lastUpdated: string | null;
}

export type MRTrackerStatus = "unconfigured" | "idle" | "refreshing" | "ready" | "error";

export interface MRTrackerViewState {
  status: MRTrackerStatus;
  settings: MRTrackerSettings;
  hasToken: boolean;
  mergeRequests: MergeRequestSnapshot[];
  lastUpdated: string | null;
  errors: string[];
  counts: Record<MRTrackerTab, number>;
  automation: MRAutomationViewState;
}

export interface MRTrackerNotification {
  kind: "new_owned" | "ready" | "pipeline_failed";
  mergeRequestId: string;
  title: string;
  body: string;
  webUrl: string;
}

export const DEFAULT_MR_TRACKER_SETTINGS: MRTrackerSettings = {
  gitLabBaseUrl: "",
  gitLabUsername: "",
  authors: [],
  activityUsers: [],
  includeReviewerMergeRequests: true,
  tokenType: "private-token",
  refreshIntervalSeconds: 120,
};

export const DEFAULT_MR_TRACKER_PERSISTED_STATE: MRTrackerPersistedState = {
  trackedItems: [],
  importance: {},
  baselineEstablished: false,
  previousOwnedIds: [],
  readinessById: {},
  failedPipelineIdByMrId: {},
  snapshots: [],
  lastUpdated: null,
};
