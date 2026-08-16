import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  type DiffContextRegion,
  type LoadedDiffContextLine,
  buildDiffContextRegions,
  withExpandedDiffContext,
} from "@/git/diff-context-expansion";
import { searchChangesFiles } from "@/git/changes-search";

type ExpandDirection = "up" | "down" | "all";

interface ExpansionState {
  scopeKey: string;
  linesByFile: Record<string, LoadedDiffContextLine[]>;
  loadingKeys: string[];
}

const CONTEXT_PAGE_SIZE = 5_000;

const EMPTY_STATE: ExpansionState = { scopeKey: "", linesByFile: {}, loadingKeys: [] };

function expansionRequest(region: DiffContextRegion, direction: ExpandDirection) {
  if (direction === "up") {
    const limit = Math.min(20, region.lineCount);
    return { offset: region.lineCount - limit, limit };
  }
  return {
    offset: 0,
    limit: direction === "all" ? Math.min(5_000, region.lineCount) : Math.min(20, region.lineCount),
  };
}

function mergeLoadedLines(
  current: readonly LoadedDiffContextLine[],
  incoming: readonly LoadedDiffContextLine[],
): LoadedDiffContextLine[] {
  const byLine = new Map(current.map((line) => [line.newLineNumber, line] as const));
  for (const line of incoming) byLine.set(line.newLineNumber, line);
  return [...byLine.values()].sort((left, right) => left.newLineNumber - right.newLineNumber);
}

export function useDiffContextExpansion(input: {
  serverId: string;
  cwd: string;
  compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean };
  files: ParsedDiffFile[];
  supported: boolean;
  requestedLines?: ReadonlyArray<{ filePath: string; lineNumber: number }>;
}) {
  const client = useHostRuntimeClient(input.serverId);
  const scopeKey = useMemo(
    () =>
      JSON.stringify({
        cwd: input.cwd,
        compare: input.compare,
        revisions: input.files.map((file) => [file.path, file.revision]),
      }),
    [input.compare, input.cwd, input.files],
  );
  const [state, setState] = useState<ExpansionState>(EMPTY_STATE);
  const sourceCacheRef = useRef(new Map<string, string[]>());
  const activeState = useMemo(
    () => (state.scopeKey === scopeKey ? state : { ...EMPTY_STATE, scopeKey }),
    [scopeKey, state],
  );

  const files = useMemo(
    () =>
      input.supported
        ? input.files.map((file) =>
            withExpandedDiffContext(file, activeState.linesByFile[file.path] ?? []),
          )
        : input.files,
    [activeState.linesByFile, input.files, input.supported],
  );

  const expand = useCallback(
    async (filePath: string, region: DiffContextRegion, direction: ExpandDirection) => {
      if (!input.supported || !client) return;
      const file = input.files.find((candidate) => candidate.path === filePath);
      if (!file?.revision) return;
      const request = expansionRequest(region, direction);
      const loadingKey = `${filePath}:${region.oldStart}:${region.newStart}:${region.lineCount}:${direction}`;
      setState((current) => {
        const base = current.scopeKey === scopeKey ? current : { ...EMPTY_STATE, scopeKey };
        return base.loadingKeys.includes(loadingKey)
          ? base
          : { ...base, loadingKeys: [...base.loadingKeys, loadingKey] };
      });
      try {
        const payload = await client.getCheckoutDiffContext(input.cwd, {
          compare: input.compare,
          filePath,
          expectedRevision: file.revision,
          region,
          ...request,
        });
        setState((current) => {
          if (current.scopeKey !== scopeKey) return current;
          return {
            ...current,
            linesByFile: {
              ...current.linesByFile,
              [filePath]: mergeLoadedLines(current.linesByFile[filePath] ?? [], payload.lines),
            },
          };
        });
      } finally {
        setState((current) =>
          current.scopeKey === scopeKey
            ? {
                ...current,
                loadingKeys: current.loadingKeys.filter((key) => key !== loadingKey),
              }
            : current,
        );
      }
    },
    [client, input.compare, input.cwd, input.files, input.supported, scopeKey],
  );

  const expandFile = useCallback(
    async (filePath: string) => {
      if (!input.supported || !client) return;
      const file = input.files.find((candidate) => candidate.path === filePath);
      if (!file?.revision) return;
      const loadingKey = `${filePath}:full`;
      if (activeState.loadingKeys.includes(loadingKey)) return;
      setState((current) => {
        const base = current.scopeKey === scopeKey ? current : { ...EMPTY_STATE, scopeKey };
        return { ...base, loadingKeys: [...base.loadingKeys, loadingKey] };
      });
      try {
        for (const region of buildDiffContextRegions(file)) {
          let offset = 0;
          while (offset < region.lineCount) {
            const payload = await client.getCheckoutDiffContext(input.cwd, {
              compare: input.compare,
              filePath,
              expectedRevision: file.revision,
              region,
              offset,
              limit: Math.min(CONTEXT_PAGE_SIZE, region.lineCount - offset),
            });
            if (payload.lines.length === 0) {
              throw new Error("The host returned an empty context page");
            }
            setState((current) => {
              if (current.scopeKey !== scopeKey) return current;
              return {
                ...current,
                linesByFile: {
                  ...current.linesByFile,
                  [filePath]: mergeLoadedLines(current.linesByFile[filePath] ?? [], payload.lines),
                },
              };
            });
            offset += payload.lines.length;
          }
        }
      } finally {
        setState((current) =>
          current.scopeKey === scopeKey
            ? {
                ...current,
                loadingKeys: current.loadingKeys.filter((key) => key !== loadingKey),
              }
            : current,
        );
      }
    },
    [
      activeState.loadingKeys,
      client,
      input.compare,
      input.cwd,
      input.files,
      input.supported,
      scopeKey,
    ],
  );

  const loadSourceLines = useCallback(
    async (file: ParsedDiffFile): Promise<string[] | null> => {
      if (
        !input.supported ||
        !client ||
        !file.revision ||
        file.isDeleted ||
        file.status === "binary" ||
        file.status === "too_large" ||
        !file.newLineCount
      ) {
        return null;
      }
      const cacheKey = `${scopeKey}:${file.path}:${file.revision}`;
      const cached = sourceCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const lines: string[] = [];
      const region = { oldStart: 1, newStart: 1, lineCount: file.newLineCount };
      let offset = 0;
      while (offset < region.lineCount) {
        const payload = await client.getCheckoutDiffContext(input.cwd, {
          compare: input.compare,
          filePath: file.path,
          expectedRevision: file.revision,
          region,
          offset,
          limit: Math.min(CONTEXT_PAGE_SIZE, region.lineCount - offset),
        });
        if (payload.lines.length === 0) throw new Error("The host returned an empty source page");
        lines.push(...payload.lines.map((line) => line.content));
        offset += payload.lines.length;
      }
      sourceCacheRef.current.set(cacheKey, lines);
      return lines;
    },
    [client, input.compare, input.cwd, input.supported, scopeKey],
  );

  const search = useCallback(
    async (query: string) => {
      const searchable = await Promise.all(
        input.files.map(async (file) => ({
          path: file.path,
          lines: await loadSourceLines(file),
        })),
      );
      return searchChangesFiles(searchable, query);
    },
    [input.files, loadSourceLines],
  );

  const loadSource = useCallback(
    async (filePath: string) => {
      const file = input.files.find((candidate) => candidate.path === filePath);
      if (!file) return null;
      const lines = await loadSourceLines(file);
      return lines ? lines.join("\n") : null;
    },
    [input.files, loadSourceLines],
  );

  useEffect(() => {
    if (!input.supported || activeState.loadingKeys.length > 0) return;
    for (const requested of input.requestedLines ?? []) {
      const file = input.files.find((candidate) => candidate.path === requested.filePath);
      if (!file) continue;
      const alreadyLoaded = (activeState.linesByFile[file.path] ?? []).some(
        (line) => line.newLineNumber === requested.lineNumber,
      );
      if (alreadyLoaded) continue;
      const region = buildDiffContextRegions(file).find(
        (candidate) =>
          requested.lineNumber >= candidate.newStart &&
          requested.lineNumber < candidate.newStart + candidate.lineCount,
      );
      if (!region) continue;
      const relativeLine = requested.lineNumber - region.newStart;
      const offset = Math.max(0, Math.min(relativeLine - 10, region.lineCount - 20));
      const segment = {
        oldStart: region.oldStart + offset,
        newStart: region.newStart + offset,
        lineCount: Math.min(20, region.lineCount - offset),
      };
      void expand(file.path, segment, "all").catch(() => undefined);
      break;
    }
  }, [activeState, expand, input.files, input.requestedLines, input.supported]);

  const expandingFilePaths = useMemo(
    () =>
      activeState.loadingKeys.filter((key) => key.endsWith(":full")).map((key) => key.slice(0, -5)),
    [activeState.loadingKeys],
  );

  return {
    files,
    expand,
    expandFile,
    search,
    loadSource,
    expandingFilePaths,
    isLoading: activeState.loadingKeys.length > 0,
  };
}
