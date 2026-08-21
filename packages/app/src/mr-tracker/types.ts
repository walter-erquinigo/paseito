export type MRTrackerTab = "all" | "my_mrs" | "others";
export type MRImportance = "important" | "ignored";

export interface MRTrackerSettings {
  gitLabBaseUrl: string;
  gitLabUsername: string;
  authors: string[];
  activityUsers: GitLabUserSummary[];
  includeReviewerMergeRequests: boolean;
  tokenType: "private-token" | "bearer";
  refreshIntervalSeconds: 120;
}

export interface GitLabUserSummary {
  id: number;
  name: string | null;
  username: string;
  webUrl: string | null;
  avatarUrl: string | null;
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
  pipeline: {
    id: number | null;
    status: string;
    webUrl: string | null;
    updatedAt: string | null;
  } | null;
  approvals: {
    approvedBy: GitLabUserSummary[];
    approvalsRequired: number | null;
    approvalsLeft: number | null;
    rulesLeft: number | null;
    error: string | null;
  };
  discussions: {
    unresolvedCount: number | null;
    resolvableCount: number | null;
    activity: Array<{
      user: GitLabUserSummary;
      noteCount: number;
      unresolvedCount: number;
    }>;
    error: string | null;
  };
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

export interface MRTrackerViewState {
  status: "unconfigured" | "idle" | "refreshing" | "ready" | "error";
  settings: MRTrackerSettings;
  hasToken: boolean;
  mergeRequests: MergeRequestSnapshot[];
  lastUpdated: string | null;
  errors: string[];
  counts: Record<MRTrackerTab, number>;
}
