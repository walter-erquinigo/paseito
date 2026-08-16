export function collapseReviewedFile(paths: ReadonlySet<string>, reviewedPath: string): string[] {
  return Array.from(paths).filter((path) => path !== reviewedPath);
}

export function expandUnreviewedFile(paths: ReadonlySet<string>, unreviewedPath: string): string[] {
  return Array.from(new Set([...paths, unreviewedPath]));
}

export function expandInvalidatedFiles(
  paths: ReadonlySet<string>,
  invalidatedPaths: readonly string[],
): string[] {
  const expanded = new Set(paths);
  for (const path of invalidatedPaths) expanded.add(path);
  return Array.from(expanded);
}

export function expandOnlyUnreviewedFiles(
  filePaths: readonly string[],
  reviewedPaths: ReadonlySet<string>,
): string[] {
  return filePaths.filter((path) => !reviewedPaths.has(path));
}

export function collapseReviewedFiles(
  filePaths: readonly string[],
  reviewedPaths: ReadonlySet<string>,
): string[] {
  return filePaths.filter((path) => reviewedPaths.has(path));
}

export function revealFileAncestorFolders(
  collapsedFolders: readonly string[],
  filePaths: readonly string[],
): string[] {
  const ancestors = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/").slice(0, -1);
    for (const index of parts.keys()) ancestors.add(parts.slice(0, index + 1).join("/"));
  }
  return collapsedFolders.filter((folder) => !ancestors.has(folder));
}
