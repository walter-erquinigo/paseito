import type { ParsedDiffFile } from "@/git/use-diff-query";
import {
  buildDiffTree,
  compressSingleChildChains,
  flattenDiffTree,
  type DiffTreeRow,
} from "@/git/diff-tree";

interface ActivateChangesFileInput {
  expandedPaths: string[] | null;
  focusRequestId: number;
  path: string;
}

export interface ChangesFileActivation {
  expandedPaths: string[] | null;
  focusPath: string;
  focusRequestId: number;
  selectedPath: string;
}

export function resolveChangesHeaderFocusOffset(input: {
  headerOffset: number;
  headerHeight: number;
  viewportOffset: number;
  viewportHeight: number;
  reveal?: "center-if-hidden";
}): number | null {
  if (input.reveal !== "center-if-hidden") return input.headerOffset;
  const headerVisible =
    input.headerOffset >= input.viewportOffset &&
    input.headerOffset + input.headerHeight <= input.viewportOffset + input.viewportHeight;
  return headerVisible
    ? null
    : Math.max(0, input.headerOffset - (input.viewportHeight - input.headerHeight) / 2);
}

export type ChangesFileStatus = "added" | "deleted" | "modified";

export function getChangesFileStatus(file: ParsedDiffFile): ChangesFileStatus {
  if (file.isNew) {
    return "added";
  }
  if (file.isDeleted) {
    return "deleted";
  }
  return "modified";
}

export function buildChangesFileTreeRows(
  files: ParsedDiffFile[],
  collapsedFolders: ReadonlySet<string>,
): DiffTreeRow[] {
  const tree = compressSingleChildChains(buildDiffTree(files));
  return flattenDiffTree(tree, collapsedFolders);
}

export function activateChangesFile({
  expandedPaths,
  focusRequestId,
  path,
}: ActivateChangesFileInput): ChangesFileActivation {
  const nextExpandedPaths =
    expandedPaths === null || expandedPaths.includes(path)
      ? expandedPaths
      : [...expandedPaths, path];

  return {
    expandedPaths: nextExpandedPaths,
    focusPath: path,
    focusRequestId: focusRequestId + 1,
    selectedPath: path,
  };
}

export function retainSelectedChangesFile(
  selectedPath: string | null,
  files: ParsedDiffFile[],
): string | null {
  if (!selectedPath) {
    return null;
  }
  return files.some((file) => file.path === selectedPath) ? selectedPath : null;
}
