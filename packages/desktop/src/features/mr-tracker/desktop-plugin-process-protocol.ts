import type { MRAutomationEvaluationContext } from "./automation-types.js";

export type DesktopPluginProcessRequest =
  | { type: "initialize"; pluginId: string; bundle: string }
  | {
      type: "evaluate";
      requestId: string;
      contributionId: string;
      config: Record<string, unknown>;
      context: MRAutomationEvaluationContext;
    }
  | {
      type: "run";
      requestId: string;
      contributionId: string;
      config: Record<string, unknown>;
      context: MRAutomationEvaluationContext;
    }
  | { type: "shutdown" };

export type DesktopPluginProcessMessage =
  | {
      type: "ready";
      predicates: Array<{
        id: string;
        title: string;
        description: string;
        fields: unknown[];
      }>;
      operations: Array<{
        id: string;
        title: string;
        description: string;
        kind: "mutation" | "link";
        allowedPresentations: Array<"automatic" | "button" | "link">;
        fields: unknown[];
      }>;
    }
  | { type: "result"; requestId: string; output: unknown }
  | { type: "error"; requestId: string; error: string }
  | { type: "fatal"; error: string };
