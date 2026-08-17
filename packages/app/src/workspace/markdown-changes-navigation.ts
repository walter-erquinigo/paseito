import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { buildDiffContextRegions } from "@/git/diff-context-expansion";
import { buildNumberedDiffHunks } from "@/utils/diff-layout";
import { resolveWorkspaceFilePaths, type WorkspaceFileLocation } from "@/workspace/file-open";
import type { WorkspaceTab, WorkspaceWorkingDiffTabTarget } from "@/workspace-tabs/model";

export interface WorkingDiffNavigationSnapshot {
  tabId: string;
  files: ParsedDiffFile[];
  isLoading: boolean;
  contextExpansionSupported: boolean;
}

export interface InlineWorkingDiffNavigationSnapshot {
  files: ParsedDiffFile[];
  isLoading: boolean;
  contextExpansionSupported: boolean;
  navigate: (target: WorkspaceWorkingDiffTabTarget) => void;
}

interface RegisteredWorkingDiffSnapshot {
  owner: object;
  snapshot: WorkingDiffNavigationSnapshot;
}

const workingDiffSnapshots = new Map<string, RegisteredWorkingDiffSnapshot>();
const workingDiffSnapshotListeners = new Map<
  string,
  Set<(snapshot: WorkingDiffNavigationSnapshot) => void>
>();
const inlineWorkingDiffSnapshots = new Map<
  string,
  { owner: object; snapshot: InlineWorkingDiffNavigationSnapshot }
>();
let lastWorkingDiffFocusRequestId = 0;

export function publishWorkingDiffNavigationSnapshot(
  workspaceKey: string,
  owner: object,
  snapshot: WorkingDiffNavigationSnapshot,
): void {
  workingDiffSnapshots.set(workspaceKey, { owner, snapshot });
  for (const listener of workingDiffSnapshotListeners.get(workspaceKey) ?? []) {
    listener(snapshot);
  }
}

export function clearWorkingDiffNavigationSnapshot(workspaceKey: string, owner: object): void {
  if (workingDiffSnapshots.get(workspaceKey)?.owner === owner) {
    workingDiffSnapshots.delete(workspaceKey);
  }
}

export function getWorkingDiffNavigationSnapshot(
  workspaceKey: string,
): WorkingDiffNavigationSnapshot | null {
  return workingDiffSnapshots.get(workspaceKey)?.snapshot ?? null;
}

export function waitForWorkingDiffNavigationSnapshot(input: {
  workspaceKey: string;
  tabId: string;
  timeoutMs?: number;
}): Promise<WorkingDiffNavigationSnapshot> {
  const current = getWorkingDiffNavigationSnapshot(input.workspaceKey);
  if (current?.tabId === input.tabId && !current.isLoading) {
    return Promise.resolve(current);
  }
  return new Promise((resolve, reject) => {
    const listeners = workingDiffSnapshotListeners.get(input.workspaceKey) ?? new Set();
    const finish = (snapshot: WorkingDiffNavigationSnapshot) => {
      if (snapshot.tabId !== input.tabId || snapshot.isLoading) return;
      clearTimeout(timeout);
      listeners.delete(finish);
      if (listeners.size === 0) workingDiffSnapshotListeners.delete(input.workspaceKey);
      resolve(snapshot);
    };
    const timeout = setTimeout(() => {
      listeners.delete(finish);
      if (listeners.size === 0) workingDiffSnapshotListeners.delete(input.workspaceKey);
      reject(new Error("Changes did not finish loading."));
    }, input.timeoutMs ?? 15_000);
    listeners.add(finish);
    workingDiffSnapshotListeners.set(input.workspaceKey, listeners);
  });
}

export function publishInlineWorkingDiffNavigationSnapshot(
  workspaceKey: string,
  owner: object,
  snapshot: InlineWorkingDiffNavigationSnapshot,
): void {
  inlineWorkingDiffSnapshots.set(workspaceKey, { owner, snapshot });
}

export function clearInlineWorkingDiffNavigationSnapshot(
  workspaceKey: string,
  owner: object,
): void {
  if (inlineWorkingDiffSnapshots.get(workspaceKey)?.owner === owner) {
    inlineWorkingDiffSnapshots.delete(workspaceKey);
  }
}

export function getInlineWorkingDiffNavigationSnapshot(
  workspaceKey: string,
): InlineWorkingDiffNavigationSnapshot | null {
  return inlineWorkingDiffSnapshots.get(workspaceKey)?.snapshot ?? null;
}

export interface MarkdownChangesNavigation {
  tabId: string;
  target: WorkspaceWorkingDiffTabTarget;
}

export function resolveMarkdownChangesNavigation(input: {
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  tabs: readonly WorkspaceTab[];
  snapshot: WorkingDiffNavigationSnapshot | null;
}): MarkdownChangesNavigation | null {
  const changesTab = input.tabs.find((tab) => tab.target.kind === "working_diff") ?? null;
  const snapshot = input.snapshot;
  if (!changesTab || changesTab.target.kind !== "working_diff" || !snapshot) {
    return null;
  }
  if (snapshot.tabId !== changesTab.tabId || snapshot.isLoading) {
    return null;
  }

  const location = resolveNavigationLocation({
    workspaceRoot: input.workspaceRoot,
    location: input.location,
    files: snapshot.files,
    contextExpansionSupported: snapshot.contextExpansionSupported,
  });
  if (!location) {
    return null;
  }

  return {
    tabId: changesTab.tabId,
    target: createWorkingDiffNavigationTarget({
      current: changesTab.target,
      ...location,
    }),
  };
}

export function resolveMarkdownInlineChangesNavigation(input: {
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  snapshot: InlineWorkingDiffNavigationSnapshot | null;
}): WorkspaceWorkingDiffTabTarget | null {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.isLoading) {
    return null;
  }
  const location = resolveNavigationLocation({
    workspaceRoot: input.workspaceRoot,
    location: input.location,
    files: snapshot.files,
    contextExpansionSupported: snapshot.contextExpansionSupported,
  });
  if (!location) {
    return null;
  }
  return createWorkingDiffNavigationTarget({
    current: { kind: "working_diff" },
    ...location,
  });
}

export function createWorkingDiffNavigationTarget(input: {
  current: WorkspaceWorkingDiffTabTarget;
  path: string;
  lineStart: number;
  lineEnd?: number;
  column?: number;
}): WorkspaceWorkingDiffTabTarget {
  const lineStart = normalizePositiveInteger(input.lineStart) ?? 1;
  const lineEnd = normalizePositiveInteger(input.lineEnd);
  const column = normalizePositiveInteger(input.column);
  const currentRequestId = normalizePositiveInteger(input.current.focusRequestId) ?? 0;
  lastWorkingDiffFocusRequestId = Math.max(lastWorkingDiffFocusRequestId, currentRequestId) + 1;
  return {
    kind: "working_diff",
    focusPath: input.path,
    focusRequestId: lastWorkingDiffFocusRequestId,
    focusLineStart: lineStart,
    ...(lineEnd && lineEnd >= lineStart ? { focusLineEnd: lineEnd } : {}),
    ...(column ? { focusColumn: column } : {}),
  };
}

export function createWorkingDiffFileNavigationTarget(input: {
  current: WorkspaceWorkingDiffTabTarget;
  path: string;
}): WorkspaceWorkingDiffTabTarget {
  const currentRequestId = normalizePositiveInteger(input.current.focusRequestId) ?? 0;
  lastWorkingDiffFocusRequestId = Math.max(lastWorkingDiffFocusRequestId, currentRequestId) + 1;
  return {
    kind: "working_diff",
    focusPath: input.path,
    focusRequestId: lastWorkingDiffFocusRequestId,
    focusReveal: "center-if-hidden",
  };
}

export function canNavigateToCurrentLine(
  file: ParsedDiffFile,
  lineNumber: number,
  contextExpansionSupported: boolean,
): boolean {
  if (
    file.status !== "ok" ||
    file.isDeleted ||
    !Number.isSafeInteger(lineNumber) ||
    lineNumber <= 0 ||
    (file.newLineCount !== undefined && lineNumber > file.newLineCount)
  ) {
    return false;
  }

  const rendered = buildNumberedDiffHunks(file).some((hunk) =>
    hunk.lines.some((line) => line.newCell?.lineNumber === lineNumber),
  );
  if (rendered) {
    return true;
  }
  return (
    contextExpansionSupported &&
    buildDiffContextRegions(file).some(
      (region) => lineNumber >= region.newStart && lineNumber < region.newStart + region.lineCount,
    )
  );
}

function resolveNavigationLocation(input: {
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  files: ParsedDiffFile[];
  contextExpansionSupported: boolean;
}): {
  path: string;
  lineStart: number;
  lineEnd?: number;
  column?: number;
} | null {
  const lineStart = normalizePositiveInteger(input.location.lineStart);
  if (!lineStart) {
    return null;
  }
  const resolvedTarget = resolveWorkspaceFilePaths({
    path: input.location.path,
    workspaceRoot: input.workspaceRoot,
  });
  if (!resolvedTarget?.relativePath) {
    return null;
  }
  const file = input.files.find(
    (candidate) =>
      resolveWorkspaceFilePaths({ path: candidate.path, workspaceRoot: input.workspaceRoot })
        ?.relativePath === resolvedTarget.relativePath,
  );
  if (!file || !canNavigateToCurrentLine(file, lineStart, input.contextExpansionSupported)) {
    return null;
  }
  const lineEnd = normalizePositiveInteger(input.location.lineEnd);
  const column = normalizePositiveInteger(input.location.column);
  return {
    path: resolvedTarget.relativePath,
    lineStart,
    ...(lineEnd && lineEnd >= lineStart ? { lineEnd } : {}),
    ...(column ? { column } : {}),
  };
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}
