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
