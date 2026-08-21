import * as Zod from "zod";
import type {
  PluginMROperationContribution,
  PluginMRPredicateContribution,
  PluginMRSnapshot,
} from "@getpaseo/plugin/desktop";
import type {
  DesktopPluginProcessMessage,
  DesktopPluginProcessRequest,
} from "./desktop-plugin-process-protocol.js";
import type { MRAutomationEvaluationContext } from "./automation-types.js";

const predicates = new Map<string, PluginMRPredicateContribution>();
const operations = new Map<string, PluginMROperationContribution>();
let cleanupPlugin: (() => void | Promise<void>) | null = null;
const CONTRIBUTION_ID = /^[a-z][a-z0-9._-]*$/;

function validateContribution(
  contribution: PluginMRPredicateContribution | PluginMROperationContribution,
): void {
  if (!CONTRIBUTION_ID.test(contribution.id)) {
    throw new Error(`Invalid contribution ID: ${contribution.id}`);
  }
  if (!contribution.title.trim() || !Array.isArray(contribution.fields)) {
    throw new Error(`Contribution ${contribution.id} has invalid metadata`);
  }
}

function send(message: DesktopPluginProcessMessage): void {
  process.send?.(message);
}

function pluginSnapshot(context: MRAutomationEvaluationContext): PluginMRSnapshot {
  const mr = context.mergeRequest;
  return {
    id: mr.id,
    projectId: mr.projectId,
    iid: mr.iid,
    title: mr.title,
    description: mr.description,
    webUrl: mr.webUrl,
    state: mr.state,
    sourceBranch: mr.sourceBranch,
    targetBranch: mr.targetBranch,
    sourceSha: mr.sourceSha,
    draft: mr.draft,
    author: { id: mr.author.id, username: mr.author.username, name: mr.author.name },
    reviewers: mr.reviewers.map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
    })),
    labels: mr.labels,
    approvalsLeft: mr.approvals.approvalsLeft,
    unresolvedDiscussions: mr.discussions.unresolvedCount,
    isNew: context.isNew,
    namedPipelines:
      context.namedPipelines?.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        status: pipeline.status,
        sha: pipeline.sha,
        webUrl: pipeline.webUrl,
      })) ?? null,
  };
}

function initialize(pluginId: string, bundle: string): void {
  const requireRuntime = (name: string): unknown => {
    if (name === "zod") return Zod;
    if (name === "@getpaseo/plugin" || name === "@getpaseo/plugin/desktop") return {};
    throw new Error(`Module "${name}" is unavailable in desktop plugin code`);
  };
  const evaluate: (source: string) => unknown = globalThis.eval;
  const factory = evaluate(bundle);
  if (typeof factory !== "function") throw new Error(`Plugin ${pluginId} is not executable`);
  const exports = factory(requireRuntime);
  const setup =
    exports !== null && typeof exports === "object" ? Reflect.get(exports, "default") : undefined;
  if (typeof setup !== "function") throw new Error(`Plugin ${pluginId} has no default export`);
  const cleanup = setup({
    addMRPredicate(contribution: PluginMRPredicateContribution) {
      validateContribution(contribution);
      if (predicates.has(contribution.id))
        throw new Error(`Duplicate predicate ${contribution.id}`);
      if (typeof contribution.evaluate !== "function") {
        throw new Error(`Predicate ${contribution.id} has no evaluator`);
      }
      predicates.set(contribution.id, contribution);
    },
    addMROperation(contribution: PluginMROperationContribution) {
      validateContribution(contribution);
      if (operations.has(contribution.id))
        throw new Error(`Duplicate operation ${contribution.id}`);
      if (typeof contribution.run !== "function") {
        throw new Error(`Operation ${contribution.id} has no runner`);
      }
      if (
        !["mutation", "link"].includes(contribution.kind) ||
        !Array.isArray(contribution.allowedPresentations)
      ) {
        throw new Error(`Operation ${contribution.id} has invalid metadata`);
      }
      operations.set(contribution.id, contribution);
    },
  });
  if (typeof cleanup !== "function") throw new Error(`Plugin ${pluginId} must return cleanup`);
  cleanupPlugin = cleanup;
  send({
    type: "ready",
    predicates: [...predicates.values()].map(
      ({ evaluate: _evaluate, ...descriptor }) => descriptor,
    ),
    operations: [...operations.values()].map(({ run: _run, ...descriptor }) => descriptor),
  });
}

process.on("message", (raw: DesktopPluginProcessRequest) => {
  void (async () => {
    if (raw.type === "initialize") {
      initialize(raw.pluginId, raw.bundle);
      return;
    }
    if (raw.type === "shutdown") {
      await cleanupPlugin?.();
      process.exit(0);
    }
    try {
      if (raw.type === "evaluate") {
        const predicate = predicates.get(raw.contributionId);
        if (!predicate) throw new Error(`Predicate is unavailable: ${raw.contributionId}`);
        const output = await predicate.evaluate({
          config: raw.config,
          mergeRequest: pluginSnapshot(raw.context),
        });
        send({ type: "result", requestId: raw.requestId, output });
      } else {
        const operation = operations.get(raw.contributionId);
        if (!operation) throw new Error(`Operation is unavailable: ${raw.contributionId}`);
        const output = await operation.run({
          config: raw.config,
          mergeRequest: pluginSnapshot(raw.context),
        });
        send({ type: "result", requestId: raw.requestId, output });
      }
    } catch (error) {
      send({
        type: "error",
        requestId: raw.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })().catch((error) =>
    send({ type: "fatal", error: error instanceof Error ? error.message : String(error) }),
  );
});
