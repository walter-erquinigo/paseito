import { useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ParsedDiffFile } from "@/git/use-diff-query";

const EMPTY_RECORDS: Readonly<Record<string, FileReviewRecord>> = {};

export interface FileReviewRecord {
  reviewedRevision: string;
  lastSeenRevision: string;
  reviewedAt: string;
}

export interface FileReviewScopeInput {
  serverId: string;
  repositoryRoot: string;
  branch: string;
}

export interface FileReviewSnapshot {
  reviewedPaths: ReadonlySet<string>;
  invalidatedPaths: readonly string[];
  reviewedCount: number;
  reviewableCount: number;
}

interface FileReviewStoreState {
  recordsByScope: Record<string, Record<string, FileReviewRecord>>;
  mark: (input: { scopeKey: string; files: readonly ReviewableFile[]; reviewedAt: string }) => void;
  unmark: (input: { scopeKey: string; paths: readonly string[] }) => void;
  observe: (input: { scopeKey: string; files: readonly ReviewableFile[] }) => void;
}

interface ReviewableFile {
  path: string;
  contentRevision: string;
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

function normalizeRoot(root: string): string {
  const trimmed = root.trim();
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "");
}

export function buildFileReviewScopeKey(input: FileReviewScopeInput): string {
  return [
    "file-review",
    `server=${encodeKeyPart(input.serverId)}`,
    `repository=${encodeKeyPart(normalizeRoot(input.repositoryRoot))}`,
    `branch=${encodeKeyPart(input.branch)}`,
  ].join(":");
}

function toReviewableFiles(files: readonly ParsedDiffFile[]): ReviewableFile[] {
  return files.flatMap((file) => {
    const contentRevision = file.contentRevision?.trim();
    return contentRevision ? [{ path: file.path, contentRevision }] : [];
  });
}

export function getFileReviewSnapshot(
  records: Readonly<Record<string, FileReviewRecord>>,
  files: readonly ReviewableFile[],
): FileReviewSnapshot {
  const reviewedPaths = new Set<string>();
  const invalidatedPaths: string[] = [];
  for (const file of files) {
    const record = records[file.path];
    if (!record) continue;
    if (record.reviewedRevision === file.contentRevision) {
      reviewedPaths.add(file.path);
      continue;
    }
    if (record.lastSeenRevision !== file.contentRevision) {
      invalidatedPaths.push(file.path);
    }
  }
  return {
    reviewedPaths,
    invalidatedPaths,
    reviewedCount: reviewedPaths.size,
    reviewableCount: files.length,
  };
}

export function markFileReviewsInState(
  recordsByScope: FileReviewStoreState["recordsByScope"],
  input: { scopeKey: string; files: readonly ReviewableFile[]; reviewedAt: string },
): FileReviewStoreState["recordsByScope"] {
  if (input.files.length === 0) return recordsByScope;
  const scopeRecords = { ...recordsByScope[input.scopeKey] };
  for (const file of input.files) {
    scopeRecords[file.path] = {
      reviewedRevision: file.contentRevision,
      lastSeenRevision: file.contentRevision,
      reviewedAt: input.reviewedAt,
    };
  }
  return { ...recordsByScope, [input.scopeKey]: scopeRecords };
}

export function unmarkFileReviewsInState(
  recordsByScope: FileReviewStoreState["recordsByScope"],
  input: { scopeKey: string; paths: readonly string[] },
): FileReviewStoreState["recordsByScope"] {
  const current = recordsByScope[input.scopeKey];
  if (!current || !input.paths.some((path) => current[path])) return recordsByScope;
  const scopeRecords = { ...current };
  for (const path of input.paths) delete scopeRecords[path];
  const next = { ...recordsByScope };
  if (Object.keys(scopeRecords).length === 0) delete next[input.scopeKey];
  else next[input.scopeKey] = scopeRecords;
  return next;
}

export function observeFileReviewsInState(
  recordsByScope: FileReviewStoreState["recordsByScope"],
  input: { scopeKey: string; files: readonly ReviewableFile[] },
): FileReviewStoreState["recordsByScope"] {
  const current = recordsByScope[input.scopeKey];
  if (!current) return recordsByScope;
  let scopeRecords: Record<string, FileReviewRecord> | null = null;
  for (const file of input.files) {
    const record = current[file.path];
    if (!record || record.lastSeenRevision === file.contentRevision) continue;
    scopeRecords ??= { ...current };
    scopeRecords[file.path] = { ...record, lastSeenRevision: file.contentRevision };
  }
  return scopeRecords ? { ...recordsByScope, [input.scopeKey]: scopeRecords } : recordsByScope;
}

export const useFileReviewStore = create<FileReviewStoreState>()(
  persist(
    (set) => ({
      recordsByScope: {},
      mark: (input) => {
        set((state) => ({
          recordsByScope: markFileReviewsInState(state.recordsByScope, input),
        }));
      },
      unmark: (input) => {
        set((state) => ({
          recordsByScope: unmarkFileReviewsInState(state.recordsByScope, input),
        }));
      },
      observe: (input) => {
        set((state) => ({
          recordsByScope: observeFileReviewsInState(state.recordsByScope, input),
        }));
      },
    }),
    {
      name: "@paseo:file-review-store",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ recordsByScope: state.recordsByScope }),
    },
  ),
);

export interface FileReviewActions extends FileReviewSnapshot {
  supported: boolean;
  available: boolean;
  toggle: (path: string) => boolean;
  markAll: () => readonly string[];
  clearAll: () => void;
}

export function useFileReviews(input: {
  serverId: string;
  repositoryRoot: string | null;
  branch: string | null;
  files: readonly ParsedDiffFile[];
  supported: boolean;
}): FileReviewActions {
  const scopeKey = useMemo(() => {
    if (!input.repositoryRoot || !input.branch) return null;
    return buildFileReviewScopeKey({
      serverId: input.serverId,
      repositoryRoot: input.repositoryRoot,
      branch: input.branch,
    });
  }, [input.branch, input.repositoryRoot, input.serverId]);
  const records = useFileReviewStore((state) =>
    scopeKey ? (state.recordsByScope[scopeKey] ?? EMPTY_RECORDS) : EMPTY_RECORDS,
  );
  const mark = useFileReviewStore((state) => state.mark);
  const unmark = useFileReviewStore((state) => state.unmark);
  const observe = useFileReviewStore((state) => state.observe);
  const reviewableFiles = useMemo(() => toReviewableFiles(input.files), [input.files]);
  const snapshot = useMemo(
    () => getFileReviewSnapshot(records, reviewableFiles),
    [records, reviewableFiles],
  );

  useEffect(() => {
    if (!scopeKey || !input.supported) return;
    observe({ scopeKey, files: reviewableFiles });
  }, [input.supported, observe, reviewableFiles, scopeKey]);

  const toggle = useCallback(
    (path: string): boolean => {
      if (!scopeKey || !input.supported) return false;
      const file = reviewableFiles.find((candidate) => candidate.path === path);
      if (!file) return false;
      if (snapshot.reviewedPaths.has(path)) {
        unmark({ scopeKey, paths: [path] });
        return false;
      }
      mark({ scopeKey, files: [file], reviewedAt: new Date().toISOString() });
      return true;
    },
    [input.supported, mark, reviewableFiles, scopeKey, snapshot.reviewedPaths, unmark],
  );
  const markAll = useCallback((): readonly string[] => {
    if (!scopeKey || !input.supported) return [];
    mark({ scopeKey, files: reviewableFiles, reviewedAt: new Date().toISOString() });
    return reviewableFiles.map((file) => file.path);
  }, [input.supported, mark, reviewableFiles, scopeKey]);
  const clearAll = useCallback(() => {
    if (!scopeKey || !input.supported) return;
    unmark({ scopeKey, paths: reviewableFiles.map((file) => file.path) });
  }, [input.supported, reviewableFiles, scopeKey, unmark]);

  return {
    ...snapshot,
    supported: input.supported,
    available: input.supported && scopeKey !== null,
    toggle,
    markAll,
    clearAll,
  };
}
