import type { MergeRequestSnapshot } from "./types";

export type MRAutomationMatchState = "match" | "no_match" | "unknown";

export type MRAutomationCondition =
  | { id?: string; kind: "all" | "any"; children: MRAutomationCondition[] }
  | { id?: string; kind: "not"; child: MRAutomationCondition }
  | {
      id?: string;
      kind: "predicate";
      contributionId: string;
      config: Record<string, unknown>;
    };

export interface MRAutomationOutcome {
  id: string;
  presentation: "automatic" | "button" | "link";
  label?: string;
  requireConfirmation?: boolean;
  executionPolicy?: "per_transition" | "once_per_merge_request";
  operationId: string;
  config: Record<string, unknown>;
}

export interface MRAutomationRule {
  schemaVersion: 1;
  id: string;
  revision: number;
  name: string;
  enabled: boolean;
  scope: "owned";
  condition: MRAutomationCondition;
  outcomes: MRAutomationOutcome[];
  createdAt: string;
  updatedAt: string;
}

export type MRAutomationFieldDescriptor =
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

export interface MRAutomationPredicateDescriptor {
  id: string;
  title: string;
  description: string;
  fields: MRAutomationFieldDescriptor[];
}

export interface MRAutomationOperationDescriptor {
  id: string;
  title: string;
  description: string;
  kind: "mutation" | "link";
  allowedPresentations: Array<"automatic" | "button" | "link">;
  fields: MRAutomationFieldDescriptor[];
}

export interface MRAutomationRenderedAction {
  id: string;
  ruleId: string;
  outcomeId: string;
  label: string;
  kind: "button" | "link";
  requireConfirmation: boolean;
  href: string | null;
}

export interface MRAutomationReceipt {
  id: string;
  ruleId: string;
  ruleRevision: number;
  outcomeId: string;
  mergeRequestId: string;
  transition: number;
  presentation: "automatic" | "button";
  status: "attempting" | "succeeded" | "failed" | "uncertain";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface MRAutomationViewState {
  rules: MRAutomationRule[];
  predicates: MRAutomationPredicateDescriptor[];
  operations: MRAutomationOperationDescriptor[];
  actionsByMergeRequestId: Record<string, MRAutomationRenderedAction[]>;
  receipts: MRAutomationReceipt[];
  errors: string[];
}

export interface MRAutomationPreviewResult {
  mergeRequestId: MergeRequestSnapshot["id"];
  state: MRAutomationMatchState;
}
