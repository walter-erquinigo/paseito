import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MR_TRACKER_PERSISTED_STATE,
  DEFAULT_MR_TRACKER_SETTINGS,
  type MRImportance,
  type MRTrackerPersistedState,
  type MRTrackerSettings,
  type MRTrackerTokenType,
  type MergeRequestSnapshot,
  type TrackedMergeRequest,
} from "./types.js";

interface PersistedDocument {
  version: 1;
  settings: MRTrackerSettings;
  state: MRTrackerPersistedState;
}

export interface MRTrackerStoreData {
  settings: MRTrackerSettings;
  state: MRTrackerPersistedState;
}

export interface MRTrackerStore {
  load(): Promise<MRTrackerStoreData>;
  save(data: MRTrackerStoreData): Promise<void>;
}

export interface MRTrackerTokenStore {
  has(): Promise<boolean>;
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function tokenType(value: unknown): MRTrackerTokenType {
  return value === "bearer" ? "bearer" : "private-token";
}

function importance(value: unknown): MRImportance {
  return value === "important" ? "important" : "ignored";
}

function coerceSettings(value: unknown): MRTrackerSettings {
  const record = isRecord(value) ? value : {};
  return {
    gitLabBaseUrl: stringValue(record.gitLabBaseUrl),
    gitLabUsername: stringValue(record.gitLabUsername),
    authors: stringArray(record.authors),
    includeReviewerMergeRequests:
      typeof record.includeReviewerMergeRequests === "boolean"
        ? record.includeReviewerMergeRequests
        : DEFAULT_MR_TRACKER_SETTINGS.includeReviewerMergeRequests,
    tokenType: tokenType(record.tokenType),
    refreshIntervalSeconds: 120,
  };
}

function coerceTrackedItems(value: unknown): TrackedMergeRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): TrackedMergeRequest[] => {
    if (!isRecord(entry)) return [];
    const iid = typeof entry.iid === "number" && Number.isInteger(entry.iid) ? entry.iid : null;
    const projectId =
      typeof entry.projectId === "number" && Number.isInteger(entry.projectId)
        ? entry.projectId
        : null;
    if (iid === null || projectId === null) return [];
    const id = stringValue(entry.id);
    const projectRef = stringValue(entry.projectRef);
    if (!id || !projectRef) return [];
    return [
      {
        id,
        projectRef,
        projectId,
        projectPath: stringValue(entry.projectPath),
        iid,
        title: stringValue(entry.title),
        webUrl: stringValue(entry.webUrl),
        sourcePrompt: stringValue(entry.sourcePrompt),
        addedAt: stringValue(entry.addedAt),
        updatedAt: stringValue(entry.updatedAt),
      },
    ];
  });
}

function coerceImportance(value: unknown): Record<string, MRImportance> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([id, level]) => [id, importance(level)]));
}

function coerceBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

function coerceNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function coerceSnapshots(value: unknown): MergeRequestSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MergeRequestSnapshot[] => {
    const valid =
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.projectId === "number" &&
      typeof entry.iid === "number" &&
      typeof entry.title === "string" &&
      typeof entry.webUrl === "string";
    if (!valid) return [];
    return [
      { ...(entry as unknown as MergeRequestSnapshot), importance: importance(entry.importance) },
    ];
  });
}

function coerceState(value: unknown): MRTrackerPersistedState {
  const record = isRecord(value) ? value : {};
  return {
    trackedItems: coerceTrackedItems(record.trackedItems),
    importance: coerceImportance(record.importance),
    baselineEstablished: record.baselineEstablished === true,
    previousOwnedIds: stringArray(record.previousOwnedIds),
    readinessById: coerceBooleanRecord(record.readinessById),
    failedPipelineIdByMrId: coerceNumberRecord(record.failedPipelineIdByMrId),
    snapshots: coerceSnapshots(record.snapshots),
    lastUpdated: stringOrNull(record.lastUpdated),
  };
}

function cloneDefaults(): MRTrackerStoreData {
  return {
    settings: { ...DEFAULT_MR_TRACKER_SETTINGS, authors: [] },
    state: {
      ...DEFAULT_MR_TRACKER_PERSISTED_STATE,
      trackedItems: [],
      importance: {},
      previousOwnedIds: [],
      readinessById: {},
      failedPipelineIdByMrId: {},
      snapshots: [],
    },
  };
}

export function createMRTrackerStore(userDataPath: string): MRTrackerStore {
  const filePath = path.join(userDataPath, "mr-tracker.json");
  let cached: MRTrackerStoreData | null = null;
  let persistQueue: Promise<void> = Promise.resolve();

  return {
    async load() {
      if (cached) return structuredClone(cached);
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        if (!isRecord(parsed) || parsed.version !== 1) return cloneDefaults();
        cached = {
          settings: coerceSettings(parsed.settings),
          state: coerceState(parsed.state),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        cached = cloneDefaults();
      }
      return structuredClone(cached);
    },
    async save(data) {
      const normalized: MRTrackerStoreData = {
        settings: coerceSettings(data.settings),
        state: coerceState(data.state),
      };
      const write = async () => {
        await mkdir(userDataPath, { recursive: true });
        const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
        const document: PersistedDocument = {
          version: 1,
          settings: normalized.settings,
          state: normalized.state,
        };
        await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
        await rename(tempPath, filePath);
        await chmod(filePath, 0o600);
        cached = structuredClone(normalized);
      };
      const queued = persistQueue.then(write, write);
      persistQueue = queued.catch(() => undefined);
      await queued;
    },
  };
}

export function createMRTrackerTokenStore(userDataPath: string): MRTrackerTokenStore {
  const filePath = path.join(userDataPath, "mr-tracker-token");
  return {
    async has() {
      try {
        await readFile(filePath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async get() {
      try {
        return await readFile(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("The saved GitLab credential is unavailable. Enter the token again.", {
          cause: error,
        });
      }
    },
    async set(value) {
      const token = value.trim();
      if (!token) throw new Error("Enter a GitLab access token.");
      await mkdir(userDataPath, { recursive: true });
      const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
      await writeFile(tempPath, token, { mode: 0o600 });
      await rename(tempPath, filePath);
      await chmod(filePath, 0o600);
    },
    async clear() {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
