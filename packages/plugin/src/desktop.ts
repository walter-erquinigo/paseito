export type PluginMRMatchState = "match" | "no_match" | "unknown";

export interface PluginMRUser {
  id: number;
  username: string;
  name: string | null;
}

export interface PluginMRPipeline {
  id: number;
  name: string;
  status: string;
  sha: string;
  webUrl: string | null;
}

export interface PluginMRSnapshot {
  id: string;
  projectId: number;
  iid: number;
  title: string;
  description: string;
  webUrl: string;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  sourceSha: string;
  draft: boolean;
  author: PluginMRUser;
  reviewers: PluginMRUser[];
  labels: string[];
  approvalsLeft: number | null;
  unresolvedDiscussions: number | null;
  isNew: boolean;
  /** Null when named-pipeline facts were not loaded or GitLab returned a partial failure. */
  namedPipelines: PluginMRPipeline[] | null;
}

export type PluginMRAutomationField =
  | {
      key: string;
      type: "text" | "multiline" | "number" | "boolean" | "json";
      label: string;
      required?: boolean;
      placeholder?: string;
    }
  | {
      key: string;
      type: "select" | "multi-select";
      label: string;
      required?: boolean;
      options: Array<{ value: string; label: string }>;
    }
  | {
      key: string;
      type: "gitlab-user" | "gitlab-users";
      label: string;
      required?: boolean;
    };

export interface PluginMRPredicateContribution {
  id: string;
  title: string;
  description: string;
  fields: PluginMRAutomationField[];
  evaluate(input: {
    config: Record<string, unknown>;
    mergeRequest: PluginMRSnapshot;
  }): PluginMRMatchState | Promise<PluginMRMatchState>;
}

export interface PluginMROperationContribution {
  id: string;
  title: string;
  description: string;
  kind: "mutation" | "link";
  allowedPresentations: Array<"automatic" | "button" | "link">;
  fields: PluginMRAutomationField[];
  run(input: {
    config: Record<string, unknown>;
    mergeRequest: PluginMRSnapshot;
  }): void | string | Promise<void | string>;
}

export interface DesktopPluginContext {
  addMRPredicate(contribution: PluginMRPredicateContribution): void;
  addMROperation(contribution: PluginMROperationContribution): void;
}
