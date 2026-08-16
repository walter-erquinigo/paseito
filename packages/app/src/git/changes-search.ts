export interface ChangesSearchFile {
  path: string;
  lines: readonly string[] | null;
}

export type ChangesSearchMatch =
  | { kind: "file"; filePath: string; columnStart: number }
  | {
      kind: "text";
      filePath: string;
      lineNumber: number;
      columnStart: number;
      preview: string;
    };

export interface ChangesSearchResult {
  matches: ChangesSearchMatch[];
  truncated: boolean;
}

const MAX_SEARCH_MATCHES = 10_000;

function matchOffsets(value: string, query: string, caseSensitive: boolean): number[] {
  const haystack = caseSensitive ? value : value.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const offsets: number[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, offset);
    if (match < 0) break;
    offsets.push(match);
    offset = match + Math.max(1, needle.length);
  }
  return offsets;
}

export function searchChangesFiles(
  files: readonly ChangesSearchFile[],
  rawQuery: string,
): ChangesSearchResult {
  const query = rawQuery.trim();
  if (!query) return { matches: [], truncated: false };
  const caseSensitive = query !== query.toLocaleLowerCase();
  const matches: ChangesSearchMatch[] = [];

  for (const file of files) {
    for (const offset of matchOffsets(file.path, query, caseSensitive)) {
      matches.push({ kind: "file", filePath: file.path, columnStart: offset + 1 });
      if (matches.length === MAX_SEARCH_MATCHES) return { matches, truncated: true };
    }
    for (const [lineIndex, line] of (file.lines ?? []).entries()) {
      for (const offset of matchOffsets(line, query, caseSensitive)) {
        matches.push({
          kind: "text",
          filePath: file.path,
          lineNumber: lineIndex + 1,
          columnStart: offset + 1,
          preview: line,
        });
        if (matches.length === MAX_SEARCH_MATCHES) return { matches, truncated: true };
      }
    }
  }
  return { matches, truncated: false };
}
