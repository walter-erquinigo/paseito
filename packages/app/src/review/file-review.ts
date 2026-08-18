import { useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import {
  buildReviewableChangedFiles,
  type ReviewableChangedFile,
  type ReviewableChangedLine,
} from "./line-review";

const EMPTY_RECORDS: Readonly<Record<string, FileReviewRecord>> = {};

export interface ReviewedLineRecord {
  fingerprint: string;
  occurrence: number;
}

export interface FileReviewRecord {
  reviewedRevision: string;
  lastSeenRevision: string;
  reviewedAt: string;
  reviewedLines?: ReviewedLineRecord[];
  lastSeenDiffSignature?: string;
  lastSeenFingerprintCounts?: Record<string, number>;
}

export interface FileReviewScopeInput {
  serverId: string;
  repositoryRoot: string;
  branch: string;
}

export interface FileLineReviewProgress {
  reviewed: number;
  total: number;
}

export interface FileReviewSnapshot {
  reviewedPaths: ReadonlySet<string>;
  reviewedLineIds: ReadonlySet<string>;
  lineProgressByPath: ReadonlyMap<string, FileLineReviewProgress>;
  invalidatedPaths: readonly string[];
  reviewedCount: number;
  reviewableCount: number;
  reviewedLineCount: number;
  reviewableLineCount: number;
}

interface FileReviewStoreState {
  recordsByScope: Record<string, Record<string, FileReviewRecord>>;
  replaceRecords: (recordsByScope: FileReviewStoreState["recordsByScope"]) => void;
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

function lineRecordId(path: string, line: ReviewedLineRecord): string {
  return `${path}:${line.fingerprint}:${line.occurrence}`;
}

function allLineRecords(file: ReviewableChangedFile): ReviewedLineRecord[] {
  return file.lines.map(({ fingerprint, occurrence }) => ({ fingerprint, occurrence }));
}

function parseDiffSignature(signature: string | undefined): ReviewedLineRecord[] | null {
  if (!signature) return null;
  try {
    const parsed: unknown = JSON.parse(signature);
    if (!Array.isArray(parsed)) return null;
    const records: ReviewedLineRecord[] = [];
    for (const entry of parsed) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        !Number.isInteger(entry[1]) ||
        (entry[1] as number) < 0
      ) {
        return null;
      }
      records.push({ fingerprint: entry[0], occurrence: entry[1] as number });
    }
    return records;
  } catch {
    return null;
  }
}

function countFingerprints(lines: readonly ReviewedLineRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.fingerprint, (counts.get(line.fingerprint) ?? 0) + 1);
  }
  return counts;
}

function reviewedLineKey(line: ReviewedLineRecord): string {
  return JSON.stringify([line.fingerprint, line.occurrence]);
}

interface StableAnchorBounds {
  previous: readonly (string | null)[];
  next: readonly (string | null)[];
}

function stableAnchorBounds(
  lines: readonly ReviewedLineRecord[],
  stableFingerprints: ReadonlySet<string>,
): StableAnchorBounds {
  const previous: (string | null)[] = [];
  const next: (string | null)[] = [];
  let anchor: string | null = null;
  for (const [index, line] of lines.entries()) {
    previous[index] = anchor;
    if (stableFingerprints.has(line.fingerprint)) anchor = line.fingerprint;
  }
  anchor = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    next[index] = anchor;
    if (stableFingerprints.has(line.fingerprint)) anchor = line.fingerprint;
  }
  return { previous, next };
}

function anchoredGroupKey(
  line: ReviewedLineRecord,
  index: number,
  bounds: StableAnchorBounds,
): string {
  return JSON.stringify([
    line.fingerprint,
    bounds.previous[index] ?? "START",
    bounds.next[index] ?? "END",
  ]);
}

function groupUnstableLines(
  lines: readonly ReviewedLineRecord[],
  stableFingerprints: ReadonlySet<string>,
): Map<string, ReviewedLineRecord[]> {
  const bounds = stableAnchorBounds(lines, stableFingerprints);
  const groups = new Map<string, ReviewedLineRecord[]>();
  for (const [index, line] of lines.entries()) {
    if (stableFingerprints.has(line.fingerprint)) continue;
    const key = anchoredGroupKey(line, index, bounds);
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }
  return groups;
}

function buildSequenceRemapping(
  previousLines: readonly ReviewedLineRecord[],
  currentLines: readonly ReviewedLineRecord[],
): Map<string, ReviewedLineRecord> {
  const previousCounts = countFingerprints(previousLines);
  const currentCounts = countFingerprints(currentLines);
  const stableFingerprints = new Set(
    [...previousCounts.entries()].flatMap(([fingerprint, count]) =>
      count === 1 && currentCounts.get(fingerprint) === 1 ? [fingerprint] : [],
    ),
  );
  const remapping = new Map<string, ReviewedLineRecord>();
  const currentByFingerprint = new Map(currentLines.map((line) => [line.fingerprint, line]));

  for (const previous of previousLines) {
    if (!stableFingerprints.has(previous.fingerprint)) continue;
    const current = currentByFingerprint.get(previous.fingerprint);
    if (current) remapping.set(reviewedLineKey(previous), current);
  }

  const previousGroups = groupUnstableLines(previousLines, stableFingerprints);
  const currentGroups = groupUnstableLines(currentLines, stableFingerprints);
  for (const [key, previousGroup] of previousGroups) {
    const currentGroup = currentGroups.get(key);
    if (!currentGroup || currentGroup.length !== previousGroup.length) continue;
    for (const [index, previous] of previousGroup.entries()) {
      const current = currentGroup[index];
      if (current) remapping.set(reviewedLineKey(previous), current);
    }
  }

  return remapping;
}

function remapReviewedLinesWithoutSequence(
  record: FileReviewRecord,
  file: ReviewableChangedFile,
): ReviewedLineRecord[] {
  const previousCounts = record.lastSeenFingerprintCounts ?? {};
  return (record.reviewedLines ?? []).flatMap((line) => {
    const currentCount = file.fingerprintCounts[line.fingerprint];
    if (currentCount === undefined) return [line];
    return previousCounts[line.fingerprint] === 1 && currentCount === 1
      ? [{ fingerprint: line.fingerprint, occurrence: 0 }]
      : [];
  });
}

function remapReviewedLines(
  record: FileReviewRecord,
  file: ReviewableChangedFile,
): ReviewedLineRecord[] {
  if (!record.reviewedLines) {
    return record.reviewedRevision === file.contentRevision ? allLineRecords(file) : [];
  }
  if (record.lastSeenDiffSignature === file.diffSignature) return record.reviewedLines;

  const previousLines = parseDiffSignature(record.lastSeenDiffSignature);
  if (!previousLines) return remapReviewedLinesWithoutSequence(record, file);

  const currentLines = allLineRecords(file);
  const previousLineKeys = new Set(previousLines.map(reviewedLineKey));
  const remapping = buildSequenceRemapping(previousLines, currentLines);
  const previousCounts = record.lastSeenFingerprintCounts ?? {};
  return record.reviewedLines.flatMap((line) => {
    const currentCount = file.fingerprintCounts[line.fingerprint];
    const remapped = remapping.get(reviewedLineKey(line));
    if (remapped) return [remapped];
    if (currentCount === undefined) return [line];
    if (previousLineKeys.has(reviewedLineKey(line))) return [];
    return previousCounts[line.fingerprint] === 1 && currentCount === 1
      ? [{ fingerprint: line.fingerprint, occurrence: 0 }]
      : [];
  });
}

function currentReviewedLines(
  reviewedLines: readonly ReviewedLineRecord[],
  file: ReviewableChangedFile,
): ReviewedLineRecord[] {
  const currentIds = new Set(file.lines.map((line) => line.id));
  return reviewedLines.filter((line) => currentIds.has(lineRecordId(file.path, line)));
}

function mergeDormantLines(
  record: FileReviewRecord | undefined,
  file: ReviewableChangedFile,
  currentLines: readonly ReviewedLineRecord[],
): ReviewedLineRecord[] {
  const dormant = record?.reviewedLines?.filter(
    (line) => file.fingerprintCounts[line.fingerprint] === undefined,
  );
  return [...(dormant ?? []), ...currentLines];
}

function reviewableFilesFromLegacy(files: readonly ReviewableFile[]): ReviewableChangedFile[] {
  return files.map((file) => ({
    ...file,
    diffSignature: "",
    fingerprintCounts: {},
    lines: [],
  }));
}

export function getFileReviewSnapshot(
  records: Readonly<Record<string, FileReviewRecord>>,
  files: readonly ReviewableFile[] | readonly ReviewableChangedFile[],
): FileReviewSnapshot {
  const reviewableFiles = files.map((file) =>
    "lines" in file ? file : reviewableFilesFromLegacy([file])[0],
  );
  const reviewedPaths = new Set<string>();
  const reviewedLineIds = new Set<string>();
  const lineProgressByPath = new Map<string, FileLineReviewProgress>();
  const invalidatedPaths: string[] = [];
  let reviewedLineCount = 0;
  let reviewableLineCount = 0;

  for (const file of reviewableFiles) {
    const record = records[file.path];
    const reviewedLines = record ? remapReviewedLines(record, file) : [];
    const currentReviewedIds = currentReviewedLines(reviewedLines, file).map((line) =>
      lineRecordId(file.path, line),
    );
    for (const id of currentReviewedIds) reviewedLineIds.add(id);

    const total = file.lines.length;
    const reviewed = currentReviewedIds.length;
    reviewableLineCount += total;
    reviewedLineCount += reviewed;
    lineProgressByPath.set(file.path, { reviewed, total });

    const isReviewed =
      total > 0 ? reviewed === total : record?.reviewedRevision === file.contentRevision;
    if (isReviewed) reviewedPaths.add(file.path);

    const wasFullyReviewed = Boolean(record && record.reviewedRevision === record.lastSeenRevision);
    const newlyObserved = Boolean(
      record &&
      (record.lastSeenRevision !== file.contentRevision ||
        record.lastSeenDiffSignature !== file.diffSignature),
    );
    if (wasFullyReviewed && newlyObserved && !isReviewed) invalidatedPaths.push(file.path);
  }

  return {
    reviewedPaths,
    reviewedLineIds,
    lineProgressByPath,
    invalidatedPaths,
    reviewedCount: reviewedPaths.size,
    reviewableCount: reviewableFiles.length,
    reviewedLineCount,
    reviewableLineCount,
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
  let changed = false;
  const scopeRecords = { ...current };
  for (const file of input.files) {
    const record = current[file.path];
    if (!record || record.lastSeenRevision === file.contentRevision) continue;
    changed = true;
    scopeRecords[file.path] = { ...record, lastSeenRevision: file.contentRevision };
  }
  return changed ? { ...recordsByScope, [input.scopeKey]: scopeRecords } : recordsByScope;
}

function observeChangedFilesInState(
  recordsByScope: FileReviewStoreState["recordsByScope"],
  scopeKey: string,
  files: readonly ReviewableChangedFile[],
): FileReviewStoreState["recordsByScope"] {
  const current = recordsByScope[scopeKey];
  if (!current) return recordsByScope;
  let changed = false;
  const scopeRecords = { ...current };
  for (const file of files) {
    const record = current[file.path];
    if (!record) continue;
    if (
      record.lastSeenRevision === file.contentRevision &&
      record.lastSeenDiffSignature === file.diffSignature &&
      record.reviewedLines
    ) {
      continue;
    }
    changed = true;
    const reviewedLines = remapReviewedLines(record, file);
    const reviewedCurrentLines = currentReviewedLines(reviewedLines, file);
    const isFullyReviewed =
      file.lines.length > 0
        ? reviewedCurrentLines.length === file.lines.length
        : record.reviewedRevision === file.contentRevision;
    scopeRecords[file.path] = {
      ...record,
      reviewedRevision: isFullyReviewed ? file.contentRevision : record.reviewedRevision,
      lastSeenRevision: file.contentRevision,
      reviewedLines,
      lastSeenDiffSignature: file.diffSignature,
      lastSeenFingerprintCounts: {
        ...record.lastSeenFingerprintCounts,
        ...file.fingerprintCounts,
      },
    };
  }
  return changed ? { ...recordsByScope, [scopeKey]: scopeRecords } : recordsByScope;
}

export const useFileReviewStore = create<FileReviewStoreState>()(
  persist(
    (set) => ({
      recordsByScope: {},
      replaceRecords: (recordsByScope) => set({ recordsByScope }),
      mark: (input) =>
        set((state) => ({
          recordsByScope: markFileReviewsInState(state.recordsByScope, input),
        })),
      unmark: (input) =>
        set((state) => ({
          recordsByScope: unmarkFileReviewsInState(state.recordsByScope, input),
        })),
      observe: (input) =>
        set((state) => ({
          recordsByScope: observeFileReviewsInState(state.recordsByScope, input),
        })),
    }),
    {
      name: "@paseo:file-review-store",
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ recordsByScope: state.recordsByScope }),
      migrate: (persisted) => persisted as FileReviewStoreState,
    },
  ),
);

export interface FileReviewActions extends FileReviewSnapshot {
  supported: boolean;
  available: boolean;
  files: readonly ReviewableChangedFile[];
  lineByTargetKey: ReadonlyMap<string, ReviewableChangedLine>;
  toggle: (path: string) => boolean;
  toggleLine: (line: ReviewableChangedLine) => boolean;
  markLine: (line: ReviewableChangedLine) => boolean;
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
  const recordsByScope = useFileReviewStore((state) => state.recordsByScope);
  const replaceRecords = useFileReviewStore((state) => state.replaceRecords);
  const records = scopeKey ? (recordsByScope[scopeKey] ?? EMPTY_RECORDS) : EMPTY_RECORDS;
  const reviewableFiles = useMemo(() => buildReviewableChangedFiles(input.files), [input.files]);
  const snapshot = useMemo(
    () => getFileReviewSnapshot(records, reviewableFiles),
    [records, reviewableFiles],
  );
  const lineByTargetKey = useMemo(
    () =>
      new Map(
        reviewableFiles.flatMap((file) =>
          file.lines.map((line) => [line.target.key, line] as const),
        ),
      ),
    [reviewableFiles],
  );

  useEffect(() => {
    if (!scopeKey || !input.supported) return;
    const next = observeChangedFilesInState(
      useFileReviewStore.getState().recordsByScope,
      scopeKey,
      reviewableFiles,
    );
    if (next !== useFileReviewStore.getState().recordsByScope) replaceRecords(next);
  }, [input.supported, replaceRecords, reviewableFiles, scopeKey]);

  const updateFile = useCallback(
    (file: ReviewableChangedFile, reviewedLines: ReviewedLineRecord[]) => {
      if (!scopeKey) return;
      const current = useFileReviewStore.getState().recordsByScope;
      const scopeRecords = { ...current[scopeKey] };
      const now = new Date().toISOString();
      const mergedReviewedLines = mergeDormantLines(scopeRecords[file.path], file, reviewedLines);
      const isFullyReviewed =
        file.lines.length > 0
          ? reviewedLines.length === file.lines.length
          : scopeRecords[file.path]?.reviewedRevision === file.contentRevision;
      scopeRecords[file.path] = {
        reviewedRevision: isFullyReviewed ? file.contentRevision : "",
        lastSeenRevision: file.contentRevision,
        reviewedAt: now,
        reviewedLines: mergedReviewedLines,
        lastSeenDiffSignature: file.diffSignature,
        lastSeenFingerprintCounts: {
          ...scopeRecords[file.path]?.lastSeenFingerprintCounts,
          ...file.fingerprintCounts,
        },
      };
      replaceRecords({ ...current, [scopeKey]: scopeRecords });
    },
    [replaceRecords, scopeKey],
  );

  const toggle = useCallback(
    (path: string): boolean => {
      if (!scopeKey || !input.supported) return false;
      const file = reviewableFiles.find((candidate) => candidate.path === path);
      if (!file) return false;
      if (snapshot.reviewedPaths.has(path)) {
        replaceRecords(
          unmarkFileReviewsInState(useFileReviewStore.getState().recordsByScope, {
            scopeKey,
            paths: [path],
          }),
        );
        return false;
      }
      updateFile(file, allLineRecords(file));
      if (file.lines.length === 0) {
        const current = useFileReviewStore.getState().recordsByScope;
        replaceRecords(
          markFileReviewsInState(current, {
            scopeKey,
            files: [{ path, contentRevision: file.contentRevision }],
            reviewedAt: new Date().toISOString(),
          }),
        );
      }
      return true;
    },
    [
      input.supported,
      replaceRecords,
      reviewableFiles,
      scopeKey,
      snapshot.reviewedPaths,
      updateFile,
    ],
  );

  const setLineReviewed = useCallback(
    (line: ReviewableChangedLine, reviewed: boolean): boolean => {
      if (!scopeKey || !input.supported) return false;
      const file = reviewableFiles.find((candidate) => candidate.path === line.target.filePath);
      if (!file) return false;
      const record = records[file.path];
      const currentLines = record ? remapReviewedLines(record, file) : [];
      const ids = new Set(currentLines.map((candidate) => lineRecordId(file.path, candidate)));
      if (reviewed) ids.add(line.id);
      else ids.delete(line.id);
      updateFile(
        file,
        file.lines
          .filter((candidate) => ids.has(candidate.id))
          .map(({ fingerprint, occurrence }) => ({ fingerprint, occurrence })),
      );
      return reviewed;
    },
    [input.supported, records, reviewableFiles, scopeKey, updateFile],
  );
  const toggleLine = useCallback(
    (line: ReviewableChangedLine) => setLineReviewed(line, !snapshot.reviewedLineIds.has(line.id)),
    [setLineReviewed, snapshot.reviewedLineIds],
  );
  const markLine = useCallback(
    (line: ReviewableChangedLine) => setLineReviewed(line, true),
    [setLineReviewed],
  );
  const markAll = useCallback((): readonly string[] => {
    if (!scopeKey || !input.supported) return [];
    let next = useFileReviewStore.getState().recordsByScope;
    const scopeRecords = { ...next[scopeKey] };
    const reviewedAt = new Date().toISOString();
    for (const file of reviewableFiles) {
      const currentRecord = scopeRecords[file.path];
      scopeRecords[file.path] = {
        reviewedRevision: file.contentRevision,
        lastSeenRevision: file.contentRevision,
        reviewedAt,
        reviewedLines: mergeDormantLines(currentRecord, file, allLineRecords(file)),
        lastSeenDiffSignature: file.diffSignature,
        lastSeenFingerprintCounts: {
          ...currentRecord?.lastSeenFingerprintCounts,
          ...file.fingerprintCounts,
        },
      };
    }
    next = { ...next, [scopeKey]: scopeRecords };
    replaceRecords(next);
    return reviewableFiles.map((file) => file.path);
  }, [input.supported, replaceRecords, reviewableFiles, scopeKey]);
  const clearAll = useCallback(() => {
    if (!scopeKey || !input.supported) return;
    replaceRecords(
      unmarkFileReviewsInState(useFileReviewStore.getState().recordsByScope, {
        scopeKey,
        paths: reviewableFiles.map((file) => file.path),
      }),
    );
  }, [input.supported, replaceRecords, reviewableFiles, scopeKey]);

  return {
    ...snapshot,
    supported: input.supported,
    available: input.supported && scopeKey !== null,
    files: reviewableFiles,
    lineByTargetKey,
    toggle,
    toggleLine,
    markLine,
    markAll,
    clearAll,
  };
}
