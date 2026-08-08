export function collapseReviewedFile(paths: ReadonlySet<string>, reviewedPath: string): string[] {
  return Array.from(paths).filter((path) => path !== reviewedPath);
}

export function expandInvalidatedFiles(
  paths: ReadonlySet<string>,
  invalidatedPaths: readonly string[],
): string[] {
  const expanded = new Set(paths);
  for (const path of invalidatedPaths) expanded.add(path);
  return Array.from(expanded);
}
