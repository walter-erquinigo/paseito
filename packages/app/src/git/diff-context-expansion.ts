import type { ParsedDiffFile } from "@getpaseo/protocol/messages";

export const DIFF_CONTEXT_MARKER_PREFIX = "@@ paseito-hidden-context ";

export interface DiffContextRegion {
  oldStart: number;
  newStart: number;
  lineCount: number;
}

export interface LoadedDiffContextLine {
  oldLineNumber: number;
  newLineNumber: number;
  content: string;
  tokens?: Array<{ text: string; style: string | null }>;
}

export function buildDiffContextRegions(file: ParsedDiffFile): DiffContextRegion[] {
  if (
    file.isNew ||
    file.isDeleted ||
    file.status !== "ok" ||
    file.oldLineCount === undefined ||
    file.newLineCount === undefined ||
    !file.revision
  ) {
    return [];
  }

  const regions: DiffContextRegion[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  for (const hunk of [...file.hunks].sort((left, right) => left.newStart - right.newStart)) {
    const oldGap = hunk.oldStart - oldCursor;
    const newGap = hunk.newStart - newCursor;
    if (oldGap > 0 && oldGap === newGap) {
      regions.push({ oldStart: oldCursor, newStart: newCursor, lineCount: newGap });
    }
    oldCursor = hunk.oldStart + hunk.oldCount;
    newCursor = hunk.newStart + hunk.newCount;
  }

  const oldGap = file.oldLineCount - oldCursor + 1;
  const newGap = file.newLineCount - newCursor + 1;
  if (oldGap > 0 && oldGap === newGap) {
    regions.push({ oldStart: oldCursor, newStart: newCursor, lineCount: newGap });
  }
  return regions;
}

export function encodeDiffContextMarker(region: DiffContextRegion): string {
  return `${DIFF_CONTEXT_MARKER_PREFIX}${region.oldStart}:${region.newStart}:${region.lineCount}`;
}

export function parseDiffContextMarker(content: string): DiffContextRegion | null {
  if (!content.startsWith(DIFF_CONTEXT_MARKER_PREFIX)) {
    return null;
  }
  const values = content.slice(DIFF_CONTEXT_MARKER_PREFIX.length).split(":").map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    return null;
  }
  return { oldStart: values[0], newStart: values[1], lineCount: values[2] };
}

function markerHunk(region: DiffContextRegion): ParsedDiffFile["hunks"][number] {
  return {
    oldStart: region.oldStart,
    oldCount: 0,
    newStart: region.newStart,
    newCount: 0,
    lines: [{ type: "header", content: encodeDiffContextMarker(region) }],
  };
}

function loadedHunk(lines: LoadedDiffContextLine[]): ParsedDiffFile["hunks"][number] {
  const first = lines[0];
  return {
    oldStart: first.oldLineNumber,
    oldCount: lines.length,
    newStart: first.newLineNumber,
    newCount: lines.length,
    lines: [
      {
        type: "header",
        content: `@@ -${first.oldLineNumber},${lines.length} +${first.newLineNumber},${lines.length} @@`,
      },
      ...lines.map((line) => ({
        type: "context" as const,
        content: ` ${line.content}`,
        ...(line.tokens ? { tokens: line.tokens } : {}),
      })),
    ],
  };
}

export function withExpandedDiffContext(
  file: ParsedDiffFile,
  loadedLines: readonly LoadedDiffContextLine[],
): ParsedDiffFile {
  const loadedByNewLine = new Map(loadedLines.map((line) => [line.newLineNumber, line] as const));
  const extraHunks: ParsedDiffFile["hunks"] = [];

  for (const region of buildDiffContextRegions(file)) {
    let cursor = 0;
    while (cursor < region.lineCount) {
      const newLineNumber = region.newStart + cursor;
      const loaded = loadedByNewLine.get(newLineNumber);
      if (!loaded) {
        let missingCount = 1;
        while (
          cursor + missingCount < region.lineCount &&
          !loadedByNewLine.has(region.newStart + cursor + missingCount)
        ) {
          missingCount += 1;
        }
        extraHunks.push(
          markerHunk({
            oldStart: region.oldStart + cursor,
            newStart: region.newStart + cursor,
            lineCount: missingCount,
          }),
        );
        cursor += missingCount;
        continue;
      }

      const contiguous = [loaded];
      while (cursor + contiguous.length < region.lineCount) {
        const next = loadedByNewLine.get(region.newStart + cursor + contiguous.length);
        if (!next) break;
        contiguous.push(next);
      }
      extraHunks.push(loadedHunk(contiguous));
      cursor += contiguous.length;
    }
  }

  return {
    ...file,
    hunks: [...file.hunks, ...extraHunks].sort((left, right) => {
      if (left.newStart !== right.newStart) return left.newStart - right.newStart;
      return left.newCount - right.newCount;
    }),
  };
}
