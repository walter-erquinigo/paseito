import type { GitLabUserSummary, MRTrackerSettings } from "./types";

export interface MRTrackerSettingsFormState {
  gitLabBaseUrl: string;
  gitLabUsername: string;
  authors: string;
  activityUsers: GitLabUserSummary[];
  includeReviewerMergeRequests: boolean;
  tokenType: MRTrackerSettings["tokenType"];
  accessToken: string;
}

export interface MRTrackerSettingsFormModel {
  getState(): MRTrackerSettingsFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setGitLabBaseUrl(value: string): void;
  setGitLabUsername(value: string): void;
  setAuthors(value: string): void;
  setIncludeReviewerMergeRequests(value: boolean): void;
  setTokenType(value: MRTrackerSettings["tokenType"]): void;
  setAccessToken(value: string): void;
  addActivityUser(user: GitLabUserSummary): void;
  removeActivityUser(userId: number): void;
}

export function openMRTrackerSettingsForm(settings: MRTrackerSettings): MRTrackerSettingsFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let state: MRTrackerSettingsFormState = {
    gitLabBaseUrl: settings.gitLabBaseUrl,
    gitLabUsername: settings.gitLabUsername,
    authors: settings.authors.join(", "),
    activityUsers: [...settings.activityUsers],
    includeReviewerMergeRequests: settings.includeReviewerMergeRequests,
    tokenType: settings.tokenType,
    accessToken: "",
  };

  const publish = (next: MRTrackerSettingsFormState) => {
    if (closed) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setGitLabBaseUrl: (value) => publish({ ...state, gitLabBaseUrl: value }),
    setGitLabUsername: (value) => publish({ ...state, gitLabUsername: value }),
    setAuthors: (value) => publish({ ...state, authors: value }),
    setIncludeReviewerMergeRequests: (value) =>
      publish({ ...state, includeReviewerMergeRequests: value }),
    setTokenType: (value) => publish({ ...state, tokenType: value }),
    setAccessToken: (value) => publish({ ...state, accessToken: value }),
    addActivityUser(user) {
      if (state.activityUsers.some((entry) => entry.id === user.id)) return;
      publish({ ...state, activityUsers: [...state.activityUsers, user] });
    },
    removeActivityUser: (userId) =>
      publish({
        ...state,
        activityUsers: state.activityUsers.filter((entry) => entry.id !== userId),
      }),
  };
}
