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

interface RegisteredWorkingDiffSnapshot {
  owner: object;
  snapshot: WorkingDiffNavigationSnapshot;
}

const workingDiffSnapshots = new Map<string, RegisteredWorkingDiffSnapshot>();
let lastWorkingDiffFocusRequestId = 0;

export function publishWorkingDiffNavigationSnapshot(
  workspaceKey: string,
  owner: object,
  snapshot: WorkingDiffNavigationSnapshot,
): void {
  workingDiffSnapshots.set(workspaceKey, { owner, snapshot });
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

  const file = snapshot.files.find(
    (candidate) =>
      resolveWorkspaceFilePaths({ path: candidate.path, workspaceRoot: input.workspaceRoot })
        ?.relativePath === resolvedTarget.relativePath,
  );
  if (!file || !canNavigateToCurrentLine(file, lineStart, snapshot.contextExpansionSupported)) {
    return null;
  }

  return {
    tabId: changesTab.tabId,
    target: createWorkingDiffNavigationTarget({
      current: changesTab.target,
      path: resolvedTarget.relativePath,
      lineStart,
      lineEnd: input.location.lineEnd,
      column: input.location.column,
    }),
  };
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

function normalizePositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}
