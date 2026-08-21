import { describe, expect, it, vi } from "vitest";
import { MRAutomationEngine, evaluateCondition } from "./automation-engine.js";
import { DEFAULT_MR_AUTOMATION_STATE, type MRAutomationStore } from "./automation-store.js";
import type {
  MRAutomationEvaluationContext,
  MRAutomationPersistedState,
  MRAutomationRule,
} from "./automation-types.js";
import type { MergeRequestSnapshot } from "./types.js";

function snapshot(): MergeRequestSnapshot {
  return {
    id: "10:7",
    projectId: 10,
    projectPath: "group/project",
    iid: 7,
    title: "[Release] Fix race",
    description: "",
    webUrl: "https://gitlab.example.com/group/project/-/merge_requests/7",
    state: "opened",
    sourceBranch: "debug",
    targetBranch: "main",
    sourceSha: "abc",
    createdAt: null,
    updatedAt: null,
    draft: false,
    author: { id: 1, username: "owner", name: "Owner", webUrl: null, avatarUrl: null },
    assignees: [],
    reviewers: [],
    labels: [],
    pipeline: null,
    approvals: {
      approvedBy: [],
      approvalsRequired: 1,
      approvalsLeft: 0,
      rulesLeft: 0,
      error: null,
    },
    discussions: { unresolvedCount: 0, resolvableCount: 1, activity: [], error: null },
    mergeStatus: "can_be_merged",
    detailedMergeStatus: "mergeable",
    blockingDiscussionsResolved: true,
    sources: ["me"],
    tracked: false,
    importance: "important",
    isOwned: true,
    isReviewer: false,
    hasMergeConflict: false,
    isReady: true,
    needsAttention: false,
  };
}

function context(isNew = false): MRAutomationEvaluationContext {
  return {
    mergeRequest: snapshot(),
    isNew,
    namedPipelines: [
      {
        id: 90,
        name: "verification",
        status: "success",
        sha: "abc",
        webUrl: "https://gitlab.example.com/pipeline/90",
        updatedAt: null,
      },
    ],
  };
}

function contextWithId(id: string, isNew = false): MRAutomationEvaluationContext {
  const value = context(isNew);
  value.mergeRequest.id = id;
  value.mergeRequest.iid = Number(id.split(":").at(-1));
  return value;
}

function rule(): MRAutomationRule {
  return {
    schemaVersion: 1,
    id: "new-mr",
    revision: 1,
    name: "New MR",
    enabled: true,
    scope: "owned",
    condition: {
      kind: "all",
      children: [
        { kind: "predicate", contributionId: "paseito.mr.new", config: {} },
        {
          kind: "not",
          child: {
            kind: "predicate",
            contributionId: "gitlab.mr.draft",
            config: { value: true },
          },
        },
      ],
    },
    outcomes: [
      {
        id: "comment",
        presentation: "automatic",
        operationId: "gitlab.note.create",
        config: { body: "/run all" },
      },
    ],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

function memoryStore(initialRules = [rule()]): {
  store: MRAutomationStore;
  read(): MRAutomationPersistedState;
} {
  let state = { ...structuredClone(DEFAULT_MR_AUTOMATION_STATE), rules: initialRules };
  return {
    store: {
      async load() {
        return structuredClone(state);
      },
      async save(value) {
        state = structuredClone(value);
      },
    },
    read: () => structuredClone(state),
  };
}

describe("MR automation engine", () => {
  it("propagates unknown through nested boolean conditions", () => {
    const result = evaluateCondition(
      {
        kind: "all",
        children: [
          { kind: "predicate", contributionId: "gitlab.mr.approved", config: {} },
          {
            kind: "not",
            child: { kind: "predicate", contributionId: "missing.predicate", config: {} },
          },
        ],
      },
      context(),
    );
    expect(result).toBe("unknown");
  });

  it("reports unknown when named pipeline facts are unavailable", () => {
    const value = context();
    value.namedPipelines = null;
    expect(
      evaluateCondition(
        {
          kind: "predicate",
          contributionId: "gitlab.pipeline.exists",
          config: { name: "verification" },
        },
        value,
      ),
    ).toBe("unknown");
  });

  it("baselines silently, rearms only on a complete false state, and persists before sending", async () => {
    const memory = memoryStore();
    const engine = new MRAutomationEngine({
      store: memory.store,
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    });
    const calls: string[] = [];
    const executor = {
      async postComment(_id: string, body: string) {
        expect(memory.read().receipts.at(-1)?.status).toBe("attempting");
        calls.push(body);
      },
      async addReviewers() {},
    };

    await engine.evaluate([context(true)], true, executor);
    expect(calls).toEqual([]);
    await engine.evaluate([context(false)], false, executor);
    await engine.evaluate([context(true)], true, executor);
    expect(calls).toEqual([]);
    await engine.evaluate([context(false)], true, executor);
    await engine.evaluate([context(true)], true, executor);
    expect(calls).toEqual(["/run all"]);
    expect(memory.read().receipts.at(-1)?.status).toBe("succeeded");
  });

  it("marks an ambiguous failed mutation uncertain and never retries the transition", async () => {
    const memory = memoryStore();
    const engine = new MRAutomationEngine({ store: memory.store });
    let attempts = 0;
    const executor = {
      async postComment() {
        attempts += 1;
        throw new Error("timed out");
      },
      async addReviewers() {},
    };
    await engine.evaluate([context(false)], true, executor);
    await engine.evaluate([context(true)], true, executor);
    expect(memory.read().receipts.at(-1)?.status).toBe("uncertain");
    await engine.evaluate([context(true)], true, executor);
    expect(attempts).toBe(1);
  });

  it("runs a matching automatic rule once for an MR discovered after the silent baseline", async () => {
    const memory = memoryStore();
    const engine = new MRAutomationEngine({ store: memory.store });
    const calls: string[] = [];
    const executor = {
      async postComment(id: string) {
        calls.push(id);
      },
      async addReviewers() {},
    };

    await engine.evaluate([contextWithId("10:7")], true, executor);
    await engine.evaluate([contextWithId("10:7"), contextWithId("10:8", true)], true, executor);
    await engine.evaluate([contextWithId("10:7"), contextWithId("10:8", false)], true, executor);

    expect(calls).toEqual(["10:8"]);
  });

  it("persists once-per-MR completion across later transitions and engine restarts", async () => {
    const onceRule = rule();
    onceRule.outcomes[0] = {
      ...onceRule.outcomes[0],
      executionPolicy: "once_per_merge_request",
    };
    const memory = memoryStore([onceRule]);
    const calls: string[] = [];
    const executor = {
      async postComment(id: string) {
        calls.push(id);
      },
      async addReviewers() {},
    };
    const engine = new MRAutomationEngine({ store: memory.store });

    await engine.evaluate([context(false)], true, executor);
    await engine.evaluate([context(true)], true, executor);
    expect(calls).toEqual(["10:7"]);
    expect(memory.read().completedRuns["new-mr:comment:10:7"]).toBe(true);

    const restarted = new MRAutomationEngine({ store: memory.store });
    await restarted.evaluate([context(false)], true, executor);
    await restarted.evaluate([context(true)], true, executor);

    expect(calls).toEqual(["10:7"]);
  });

  it("accumulates actions from every matching rule", async () => {
    const first = {
      ...rule(),
      id: "first",
      condition: { kind: "predicate" as const, contributionId: "gitlab.mr.approved", config: {} },
      outcomes: [
        {
          id: "first-action",
          presentation: "button" as const,
          label: "First",
          operationId: "gitlab.note.create",
          config: { body: "FIRST" },
        },
      ],
    };
    const second = {
      ...first,
      id: "second",
      outcomes: [{ ...first.outcomes[0], id: "second-action", label: "Second" }],
    };
    const engine = new MRAutomationEngine({ store: memoryStore([first, second]).store });

    const actions = await engine.evaluate([context()], true);

    expect(actions["10:7"]?.map((action) => action.label)).toEqual(["First", "Second"]);
  });

  it("rejects a forged link presentation for a mutation plugin", async () => {
    const pluginRule: MRAutomationRule = {
      ...rule(),
      id: "forged-link",
      condition: {
        kind: "predicate",
        contributionId: "gitlab.mr.approved",
        config: {},
      },
      outcomes: [
        {
          id: "notify",
          presentation: "link",
          label: "Forged link",
          operationId: "example.notify",
          config: {},
        },
      ],
    };
    const run = vi.fn(async () => undefined);
    const engine = new MRAutomationEngine({
      store: memoryStore([pluginRule]).store,
      contributions: {
        predicates: () => [],
        operations: () => [
          {
            id: "example.notify",
            title: "Notify",
            description: "",
            kind: "mutation",
            allowedPresentations: ["button"],
            fields: [],
          },
        ],
        evaluate: async () => "unknown",
        run,
      },
    });

    expect(await engine.evaluate([context()], true)).toEqual({});
    expect(run).not.toHaveBeenCalled();
  });

  it("drops unsafe links returned by a link plugin", async () => {
    const pluginRule: MRAutomationRule = {
      ...rule(),
      id: "unsafe-link",
      condition: {
        kind: "predicate",
        contributionId: "gitlab.mr.approved",
        config: {},
      },
      outcomes: [
        {
          id: "open",
          presentation: "link",
          label: "Open",
          operationId: "example.link",
          config: {},
        },
      ],
    };
    const engine = new MRAutomationEngine({
      store: memoryStore([pluginRule]).store,
      contributions: {
        predicates: () => [],
        operations: () => [
          {
            id: "example.link",
            title: "Link",
            description: "",
            kind: "link",
            allowedPresentations: ["link"],
            fields: [],
          },
        ],
        evaluate: async () => "unknown",
        run: async () => "javascript:alert(document.domain)",
      },
    });

    expect(await engine.evaluate([context()], true)).toEqual({});
  });

  it("evaluates and executes namespaced desktop plugin contributions", async () => {
    const pluginRule: MRAutomationRule = {
      ...rule(),
      id: "plugin-rule",
      condition: {
        kind: "predicate",
        contributionId: "example.has-label",
        config: { label: "release" },
      },
      outcomes: [
        {
          id: "notify",
          presentation: "button",
          operationId: "example.notify",
          config: { channel: "local" },
        },
      ],
    };
    const run = vi.fn(async () => undefined);
    const engine = new MRAutomationEngine({
      store: memoryStore([pluginRule]).store,
      contributions: {
        predicates: () => [
          { id: "example.has-label", title: "Has label", description: "", fields: [] },
        ],
        operations: () => [
          {
            id: "example.notify",
            title: "Notify",
            description: "",
            kind: "mutation",
            allowedPresentations: ["button"],
            fields: [],
          },
        ],
        evaluate: async () => "match",
        run,
      },
    });
    await engine.load();
    expect(engine.predicateDescriptors().at(-1)?.id).toBe("example.has-label");
    expect(await engine.preview(pluginRule, [context()])).toEqual([
      { mergeRequestId: "10:7", state: "match" },
    ]);
    await engine.executeManual("plugin-rule", "notify", context(), {
      async postComment() {},
      async addReviewers() {},
    });
    expect(run).toHaveBeenCalledWith("example.notify", { channel: "local" }, context());
  });
});
