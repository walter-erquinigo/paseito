import { randomUUID } from "node:crypto";
import type {
  MRAutomationCondition,
  MRAutomationEvaluationContext,
  MRAutomationMatchState,
  MRAutomationPersistedState,
  MRAutomationPreviewResult,
  MRAutomationReceipt,
  MRAutomationRenderedAction,
  MRAutomationRule,
  MRNamedPipeline,
  MRAutomationOperationDescriptor,
  MRAutomationPredicateDescriptor,
} from "./automation-types.js";
import type { MRAutomationStore } from "./automation-store.js";
import {
  BUILTIN_MR_AUTOMATION_OPERATIONS,
  BUILTIN_MR_AUTOMATION_PREDICATES,
} from "./automation-catalog.js";

export interface MRAutomationExecutor {
  postComment(mergeRequestId: string, body: string): Promise<void>;
  addReviewers(mergeRequestId: string, usernames: string[]): Promise<void>;
}

export interface MRAutomationEngineOptions {
  store: MRAutomationStore;
  now?: () => Date;
  contributions?: MRAutomationContributionResolver;
}

export interface MRAutomationContributionResolver {
  start?(): Promise<void>;
  predicates(): MRAutomationPredicateDescriptor[];
  operations(): MRAutomationOperationDescriptor[];
  evaluate(
    id: string,
    config: Record<string, unknown>,
    context: MRAutomationEvaluationContext,
  ): Promise<MRAutomationMatchState>;
  run(
    id: string,
    config: Record<string, unknown>,
    context: MRAutomationEvaluationContext,
  ): Promise<void | string>;
}

const BUILTIN_PREDICATE_IDS = new Set(
  BUILTIN_MR_AUTOMATION_PREDICATES.map((descriptor) => descriptor.id),
);
const BUILTIN_OPERATION_IDS = new Set(
  BUILTIN_MR_AUTOMATION_OPERATIONS.map((descriptor) => descriptor.id),
);

function stringConfig(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rawStringConfig(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function stringArrayConfig(config: Record<string, unknown>, key: string): string[] | null {
  const value = config[key];
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry): entry is string => typeof entry === "string" && !!entry);
  return strings.length === value.length ? strings : null;
}

function namedPipeline(
  pipelines: readonly MRNamedPipeline[] | null,
  config: Record<string, unknown>,
): MRNamedPipeline | null {
  const name = stringConfig(config, "name");
  if (!name || !pipelines) return null;
  return pipelines.find((pipeline) => pipeline.name === name) ?? null;
}

type BuiltinPredicate = (
  config: Record<string, unknown>,
  context: MRAutomationEvaluationContext,
) => MRAutomationMatchState;

const BUILTIN_PREDICATES: Record<string, BuiltinPredicate> = {
  "paseito.mr.new": (_config, context) => (context.isNew ? "match" : "no_match"),
  "gitlab.mr.state": (config, context) => {
    const value = stringConfig(config, "value");
    if (!value) return "unknown";
    return context.mergeRequest.state === value ? "match" : "no_match";
  },
  "gitlab.mr.draft": (config, context) =>
    context.mergeRequest.draft === Boolean(config.value) ? "match" : "no_match",
  "gitlab.mr.title_contains": (config, context) => {
    const value = stringConfig(config, "value");
    if (!value) return "unknown";
    const caseSensitive = config.caseSensitive === true;
    const title = caseSensitive
      ? context.mergeRequest.title
      : context.mergeRequest.title.toLocaleLowerCase();
    const needle = caseSensitive ? value : value.toLocaleLowerCase();
    return title.includes(needle) ? "match" : "no_match";
  },
  "gitlab.mr.approved": (_config, context) => {
    const approvals = context.mergeRequest.approvals;
    if (approvals.error || approvals.approvalsLeft === null) return "unknown";
    return approvals.approvalsLeft === 0 ? "match" : "no_match";
  },
  "gitlab.discussion.user_activity_resolved": (config, context) => {
    const username = stringConfig(config, "username")?.replace(/^@/, "").toLocaleLowerCase();
    if (!username || context.mergeRequest.discussions.error) return "unknown";
    const activity = context.mergeRequest.discussions.activity.find(
      (entry) => entry.user.username.toLocaleLowerCase() === username,
    );
    if (!activity || activity.noteCount === 0) return "no_match";
    return activity.unresolvedCount === 0 ? "match" : "no_match";
  },
  "gitlab.pipeline.exists": (config, context) => {
    if (context.namedPipelines === null) return "unknown";
    return namedPipeline(context.namedPipelines, config) ? "match" : "no_match";
  },
  "gitlab.pipeline.status": (config, context) => {
    if (context.namedPipelines === null) return "unknown";
    const pipeline = namedPipeline(context.namedPipelines, config);
    const status = stringConfig(config, "status");
    if (!status) return "unknown";
    return pipeline?.status === status ? "match" : "no_match";
  },
};

export function evaluateBuiltinPredicate(
  contributionId: string,
  config: Record<string, unknown>,
  context: MRAutomationEvaluationContext,
): MRAutomationMatchState {
  return BUILTIN_PREDICATES[contributionId]?.(config, context) ?? "unknown";
}

function invertMatchState(result: MRAutomationMatchState): MRAutomationMatchState {
  if (result === "unknown") return "unknown";
  return result === "match" ? "no_match" : "match";
}

function combineMatchStates(
  kind: "all" | "any",
  results: readonly MRAutomationMatchState[],
): MRAutomationMatchState {
  const states = new Set(results);
  if (kind === "all") {
    if (states.has("no_match")) return "no_match";
    return states.has("unknown") ? "unknown" : "match";
  }
  if (states.has("match")) return "match";
  return states.has("unknown") ? "unknown" : "no_match";
}

export function evaluateCondition(
  condition: MRAutomationCondition,
  context: MRAutomationEvaluationContext,
): MRAutomationMatchState {
  if (condition.kind === "predicate") {
    return evaluateBuiltinPredicate(condition.contributionId, condition.config, context);
  }
  if (condition.kind === "not") {
    const result = evaluateCondition(condition.child, context);
    return invertMatchState(result);
  }
  const results = condition.children.map((child) => evaluateCondition(child, context));
  return combineMatchStates(condition.kind, results);
}

async function evaluateConditionWithContributions(
  condition: MRAutomationCondition,
  context: MRAutomationEvaluationContext,
  resolver?: MRAutomationContributionResolver,
): Promise<MRAutomationMatchState> {
  if (condition.kind === "predicate") {
    if (BUILTIN_PREDICATE_IDS.has(condition.contributionId)) {
      return evaluateBuiltinPredicate(condition.contributionId, condition.config, context);
    }
    if (!resolver) return "unknown";
    try {
      return await resolver.evaluate(condition.contributionId, condition.config, context);
    } catch {
      return "unknown";
    }
  }
  if (condition.kind === "not") {
    const result = await evaluateConditionWithContributions(condition.child, context, resolver);
    return invertMatchState(result);
  }
  const results = await Promise.all(
    condition.children.map((child) => evaluateConditionWithContributions(child, context, resolver)),
  );
  return combineMatchStates(condition.kind, results);
}

function stateKey(rule: MRAutomationRule, mergeRequestId: string): string {
  return `${rule.id}:${rule.revision}:${mergeRequestId}`;
}

function receiptKey(receipt: MRAutomationReceipt): string {
  return `${receipt.ruleId}:${receipt.ruleRevision}:${receipt.outcomeId}:${receipt.mergeRequestId}:${receipt.transition}`;
}

function completedRunKey(
  rule: MRAutomationRule,
  outcome: MRAutomationRule["outcomes"][number],
  mergeRequestId: string,
): string {
  return `${rule.id}:${outcome.id}:${mergeRequestId}`;
}

export class MRAutomationEngine {
  private state: MRAutomationPersistedState | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: MRAutomationEngineOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<MRAutomationPersistedState> {
    await this.options.contributions?.start?.();
    this.state ??= await this.options.store.load();
    return structuredClone(this.state);
  }

  predicateDescriptors(): MRAutomationPredicateDescriptor[] {
    return [
      ...structuredClone(BUILTIN_MR_AUTOMATION_PREDICATES),
      ...(this.options.contributions?.predicates() ?? []),
    ];
  }

  operationDescriptors(): MRAutomationOperationDescriptor[] {
    return [
      ...structuredClone(BUILTIN_MR_AUTOMATION_OPERATIONS),
      ...(this.options.contributions?.operations() ?? []),
    ];
  }

  async replaceRules(rules: MRAutomationRule[]): Promise<MRAutomationPersistedState> {
    const state = await this.requireState();
    state.rules = structuredClone(rules);
    await this.options.store.save(state);
    return structuredClone(state);
  }

  async preview(
    rule: MRAutomationRule,
    contexts: readonly MRAutomationEvaluationContext[],
  ): Promise<MRAutomationPreviewResult[]> {
    return await Promise.all(
      contexts
        .filter((context) => context.mergeRequest.isOwned)
        .map(async (context) => ({
          mergeRequestId: context.mergeRequest.id,
          state: await evaluateConditionWithContributions(
            rule.condition,
            context,
            this.options.contributions,
          ),
        })),
    );
  }

  async evaluate(
    contexts: readonly MRAutomationEvaluationContext[],
    complete: boolean,
    executor?: MRAutomationExecutor,
  ): Promise<Record<string, MRAutomationRenderedAction[]>> {
    const state = await this.requireState();
    const actions: Record<string, MRAutomationRenderedAction[]> = {};
    for (const rule of state.rules) {
      if (!rule.enabled) continue;
      const baselineEstablished = state.baselineRuleRevisions[rule.id] === rule.revision;
      for (const context of contexts) {
        await this.evaluateRuleContext(
          rule,
          context,
          complete,
          baselineEstablished,
          executor,
          actions,
          state,
        );
      }
      if (complete && !baselineEstablished) state.baselineRuleRevisions[rule.id] = rule.revision;
    }
    await this.options.store.save(state);
    return actions;
  }

  private async evaluateRuleContext(
    rule: MRAutomationRule,
    context: MRAutomationEvaluationContext,
    complete: boolean,
    baselineEstablished: boolean,
    executor: MRAutomationExecutor | undefined,
    actions: Record<string, MRAutomationRenderedAction[]>,
    state: MRAutomationPersistedState,
  ): Promise<void> {
    if (!context.mergeRequest.isOwned) return;
    const key = stateKey(rule, context.mergeRequest.id);
    const previous = state.matchStates[key];
    const current = await evaluateConditionWithContributions(
      rule.condition,
      context,
      this.options.contributions,
    );
    if (complete && current !== "unknown") state.matchStates[key] = current;
    if (current !== "match") return;
    const rendered = await this.renderActions(rule, context);
    if (rendered.length) {
      actions[context.mergeRequest.id] = [...(actions[context.mergeRequest.id] ?? []), ...rendered];
    }
    await this.runAutomaticOutcomes({
      rule,
      context,
      complete,
      baselineEstablished,
      previous,
      executor,
      key,
      state,
    });
  }

  private async renderActions(
    rule: MRAutomationRule,
    context: MRAutomationEvaluationContext,
  ): Promise<MRAutomationRenderedAction[]> {
    const rendered: MRAutomationRenderedAction[] = [];
    const operations = this.operationDescriptors();
    for (const outcome of rule.outcomes) {
      if (outcome.presentation === "automatic") continue;
      const operation = operations.find((candidate) => candidate.id === outcome.operationId);
      if (
        !operation?.allowedPresentations.includes(outcome.presentation) ||
        (outcome.presentation === "link" && operation.kind !== "link") ||
        (outcome.presentation === "button" && operation.kind !== "mutation")
      ) {
        continue;
      }
      const href =
        outcome.presentation === "link"
          ? await this.resolveLink(outcome.operationId, outcome.config, context)
          : null;
      if (outcome.presentation === "link" && !href) continue;
      rendered.push({
        id: `${rule.id}:${rule.revision}:${outcome.id}`,
        ruleId: rule.id,
        outcomeId: outcome.id,
        label: outcome.label?.trim() || outcome.operationId,
        kind: outcome.presentation,
        requireConfirmation:
          outcome.presentation === "button" && outcome.requireConfirmation !== false,
        href,
      });
    }
    return rendered;
  }

  private async runAutomaticOutcomes(input: {
    rule: MRAutomationRule;
    context: MRAutomationEvaluationContext;
    complete: boolean;
    baselineEstablished: boolean;
    previous: MRAutomationMatchState | undefined;
    executor: MRAutomationExecutor | undefined;
    key: string;
    state: MRAutomationPersistedState;
  }): Promise<void> {
    if (
      !input.baselineEstablished ||
      (input.previous !== undefined && input.previous !== "no_match") ||
      !input.complete ||
      !input.executor
    ) {
      return;
    }
    const transition = (input.state.transitions[input.key] ?? 0) + 1;
    input.state.transitions[input.key] = transition;
    const automatic = input.rule.outcomes.filter(
      (candidate) =>
        candidate.presentation === "automatic" &&
        this.operationDescriptors().some(
          (operation) =>
            operation.id === candidate.operationId &&
            operation.kind === "mutation" &&
            operation.allowedPresentations.includes("automatic"),
        ),
    );
    for (const outcome of automatic) {
      const onceKey =
        outcome.executionPolicy === "once_per_merge_request"
          ? completedRunKey(input.rule, outcome, input.context.mergeRequest.id)
          : undefined;
      if (onceKey && input.state.completedRuns[onceKey]) continue;
      try {
        await this.executeWithReceipt(
          input.rule,
          outcome,
          input.context,
          transition,
          input.executor,
          onceKey,
        );
      } catch {
        // The persisted uncertain receipt is the recovery surface. Automatic
        // execution never retries or prevents the remaining refresh from settling.
      }
    }
  }

  async executeManual(
    ruleId: string,
    outcomeId: string,
    context: MRAutomationEvaluationContext,
    executor: MRAutomationExecutor,
  ): Promise<void> {
    const state = await this.requireState();
    const rule = state.rules.find((candidate) => candidate.id === ruleId && candidate.enabled);
    if (
      !rule ||
      (await evaluateConditionWithContributions(
        rule.condition,
        context,
        this.options.contributions,
      )) !== "match"
    ) {
      throw new Error("This automation action is no longer available.");
    }
    const outcome = rule.outcomes.find(
      (candidate) => candidate.id === outcomeId && candidate.presentation === "button",
    );
    const operation = outcome
      ? this.operationDescriptors().find((candidate) => candidate.id === outcome.operationId)
      : undefined;
    if (
      !outcome ||
      operation?.kind !== "mutation" ||
      !operation.allowedPresentations.includes("button")
    ) {
      throw new Error("This automation action is no longer available.");
    }
    await this.executeWithReceipt(rule, outcome, context, 0, executor);
  }

  private async executeWithReceipt(
    rule: MRAutomationRule,
    outcome: MRAutomationRule["outcomes"][number],
    context: MRAutomationEvaluationContext,
    transition: number,
    executor: MRAutomationExecutor,
    onceKey?: string,
  ): Promise<void> {
    const state = await this.requireState();
    if (onceKey && state.completedRuns[onceKey]) return;
    const mergeRequestId = context.mergeRequest.id;
    const receipt: MRAutomationReceipt = {
      id: randomUUID(),
      ruleId: rule.id,
      ruleRevision: rule.revision,
      outcomeId: outcome.id,
      mergeRequestId,
      transition,
      presentation: outcome.presentation === "automatic" ? "automatic" : "button",
      status: "attempting",
      startedAt: this.now().toISOString(),
      finishedAt: null,
      error: null,
    };
    if (
      transition > 0 &&
      state.receipts.some((candidate) => receiptKey(candidate) === receiptKey(receipt))
    ) {
      return;
    }
    if (onceKey) state.completedRuns[onceKey] = true;
    state.receipts.push(receipt);
    state.receipts = state.receipts.slice(-500);
    await this.options.store.save(state);
    try {
      if (outcome.operationId === "gitlab.note.create") {
        const body = rawStringConfig(outcome.config, "body");
        if (!body) throw new Error("Comment body is required.");
        await executor.postComment(mergeRequestId, body);
      } else if (outcome.operationId === "gitlab.reviewers.add") {
        const usernames = stringArrayConfig(outcome.config, "usernames");
        if (!usernames?.length) throw new Error("At least one reviewer is required.");
        await executor.addReviewers(mergeRequestId, usernames);
      } else if (!BUILTIN_OPERATION_IDS.has(outcome.operationId) && this.options.contributions) {
        const output = await this.options.contributions.run(
          outcome.operationId,
          outcome.config,
          context,
        );
        if (typeof output === "string") {
          throw new Error("A mutation operation cannot return a link.");
        }
      } else {
        throw new Error(`Unsupported automation operation: ${outcome.operationId}`);
      }
      receipt.status = "succeeded";
    } catch (error) {
      receipt.status = "uncertain";
      receipt.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      receipt.finishedAt = this.now().toISOString();
      await this.options.store.save(state);
    }
  }

  private async resolveLink(
    operationId: string,
    config: Record<string, unknown>,
    context: MRAutomationEvaluationContext,
  ): Promise<string | null> {
    if (operationId === "gitlab.pipeline.open") {
      return safeExternalUrl(namedPipeline(context.namedPipelines, config)?.webUrl ?? null);
    }
    if (!this.options.contributions) return null;
    try {
      const output = await this.options.contributions.run(operationId, config, context);
      return typeof output === "string" ? safeExternalUrl(output) : null;
    } catch {
      return null;
    }
  }

  private async requireState(): Promise<MRAutomationPersistedState> {
    this.state ??= await this.options.store.load();
    return this.state;
  }
}
