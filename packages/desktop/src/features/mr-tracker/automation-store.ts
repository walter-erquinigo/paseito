import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MRAutomationMatchState,
  MRAutomationPersistedState,
  MRAutomationReceipt,
  MRAutomationRule,
} from "./automation-types.js";

export interface MRAutomationStore {
  load(): Promise<MRAutomationPersistedState>;
  save(value: MRAutomationPersistedState): Promise<void>;
}

export const DEFAULT_MR_AUTOMATION_STATE: MRAutomationPersistedState = {
  version: 1,
  rules: [],
  matchStates: {},
  transitions: {},
  baselineRuleRevisions: {},
  completedRuns: {},
  receipts: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function executionPolicy(value: unknown): MRAutomationRule["outcomes"][number]["executionPolicy"] {
  if (value === "once_per_merge_request" || value === "per_transition") return value;
  return undefined;
}

function condition(value: unknown, nodePath = "condition"): MRAutomationRule["condition"] | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : nodePath;
  if (value.kind === "not") {
    const child = condition(value.child, `${nodePath}.child`);
    return child ? { id, kind: "not", child } : null;
  }
  if (value.kind === "all" || value.kind === "any") {
    if (!Array.isArray(value.children)) return null;
    const children = value.children.map((child, index) => condition(child, `${nodePath}.${index}`));
    return children.every((child) => child !== null)
      ? { id, kind: value.kind, children: children as MRAutomationRule["condition"][] }
      : null;
  }
  if (
    value.kind === "predicate" &&
    typeof value.contributionId === "string" &&
    isRecord(value.config)
  ) {
    return {
      kind: "predicate",
      id,
      contributionId: value.contributionId,
      config: value.config,
    };
  }
  return null;
}

function rules(value: unknown): MRAutomationRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MRAutomationRule[] => {
    if (!isRecord(entry)) return [];
    const parsedCondition = condition(entry.condition);
    if (
      entry.schemaVersion !== 1 ||
      typeof entry.id !== "string" ||
      typeof entry.revision !== "number" ||
      typeof entry.name !== "string" ||
      typeof entry.enabled !== "boolean" ||
      !parsedCondition ||
      !Array.isArray(entry.outcomes)
    ) {
      return [];
    }
    const outcomes = entry.outcomes.flatMap((outcome): MRAutomationRule["outcomes"] => {
      if (
        !isRecord(outcome) ||
        typeof outcome.id !== "string" ||
        !["automatic", "button", "link"].includes(String(outcome.presentation)) ||
        typeof outcome.operationId !== "string" ||
        !isRecord(outcome.config)
      ) {
        return [];
      }
      return [
        {
          id: outcome.id,
          presentation: outcome.presentation as "automatic" | "button" | "link",
          label: typeof outcome.label === "string" ? outcome.label : undefined,
          requireConfirmation:
            typeof outcome.requireConfirmation === "boolean"
              ? outcome.requireConfirmation
              : undefined,
          executionPolicy: executionPolicy(outcome.executionPolicy),
          operationId: outcome.operationId,
          config: outcome.config,
        },
      ];
    });
    if (outcomes.length !== entry.outcomes.length) return [];
    return [
      {
        schemaVersion: 1,
        id: entry.id,
        revision: Math.max(1, Math.floor(entry.revision)),
        name: entry.name,
        enabled: entry.enabled,
        scope: "owned",
        condition: parsedCondition,
        outcomes,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      },
    ];
  });
}

function stringRecord<T extends string>(value: unknown, allowed: readonly T[]): Record<string, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, T] =>
        typeof entry[1] === "string" && allowed.includes(entry[1] as T),
    ),
  );
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0,
    ),
  );
}

function trueRecord(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, true] => entry[1] === true),
  );
}

function receipts(value: unknown): MRAutomationReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MRAutomationReceipt[] => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.id !== "string" ||
      typeof entry.ruleId !== "string" ||
      typeof entry.ruleRevision !== "number" ||
      typeof entry.outcomeId !== "string" ||
      typeof entry.mergeRequestId !== "string" ||
      typeof entry.transition !== "number" ||
      !["automatic", "button"].includes(String(entry.presentation)) ||
      !["attempting", "succeeded", "failed", "uncertain"].includes(String(entry.status)) ||
      typeof entry.startedAt !== "string"
    ) {
      return [];
    }
    return [entry as unknown as MRAutomationReceipt];
  });
}

function parse(value: unknown): MRAutomationPersistedState {
  const record = isRecord(value) && value.version === 1 ? value : {};
  return {
    version: 1,
    rules: rules(record.rules),
    matchStates: stringRecord<MRAutomationMatchState>(record.matchStates, [
      "match",
      "no_match",
      "unknown",
    ]),
    transitions: numberRecord(record.transitions),
    baselineRuleRevisions: numberRecord(record.baselineRuleRevisions),
    completedRuns: trueRecord(record.completedRuns),
    receipts: receipts(record.receipts).slice(-500),
  };
}

export function createMRAutomationStore(userDataPath: string): MRAutomationStore {
  const filePath = path.join(userDataPath, "mr-automations.json");
  let cached: MRAutomationPersistedState | null = null;
  let persistQueue = Promise.resolve();
  return {
    async load() {
      if (cached) return structuredClone(cached);
      try {
        cached = parse(JSON.parse(await readFile(filePath, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        cached = structuredClone(DEFAULT_MR_AUTOMATION_STATE);
      }
      return structuredClone(cached);
    },
    async save(value) {
      const normalized = parse(value);
      const write = async () => {
        await mkdir(userDataPath, { recursive: true });
        const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
        await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
        await rename(temporaryPath, filePath);
        await chmod(filePath, 0o600);
        cached = structuredClone(normalized);
      };
      const queued = persistQueue.then(write, write);
      persistQueue = queued.catch(() => undefined);
      await queued;
    },
  };
}
