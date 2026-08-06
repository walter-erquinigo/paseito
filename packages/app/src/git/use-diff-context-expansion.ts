import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  type DiffContextRegion,
  type LoadedDiffContextLine,
  buildDiffContextRegions,
  withExpandedDiffContext,
} from "@/git/diff-context-expansion";

type ExpandDirection = "up" | "down" | "all";

interface ExpansionState {
  scopeKey: string;
  linesByFile: Record<string, LoadedDiffContextLine[]>;
  loadingKeys: string[];
}

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

  return { files, expand, isLoading: activeState.loadingKeys.length > 0 };
}
