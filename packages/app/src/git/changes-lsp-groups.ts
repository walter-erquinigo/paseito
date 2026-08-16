import { lspLanguageForFile, type WorkspaceLspLanguage } from "@/file-pane/editor/lsp-preferences";
import type { EditorLspSnapshot } from "@/file-pane/editor/lsp-session";
import type { ParsedDiffFile } from "@/git/use-diff-query";

export interface ChangesLspGroup {
  language: WorkspaceLspLanguage;
  paths: string[];
}

export function groupChangesLspFiles(files: readonly ParsedDiffFile[]): ChangesLspGroup[] {
  const groups = new Map<WorkspaceLspLanguage, Set<string>>();
  for (const file of files) {
    const language = lspLanguageForFile(file.path);
    if (!language || file.isDeleted) continue;
    const paths = groups.get(language) ?? new Set<string>();
    paths.add(file.path);
    groups.set(language, paths);
  }
  return Array.from(groups, ([language, paths]) => ({ language, paths: [...paths] })).sort((a, b) =>
    a.language.localeCompare(b.language),
  );
}

// Dormant files have a connecting snapshot but no lease. They must not hide the
// active provider or an error in a visible file. Return an existing stable snapshot
// so useSyncExternalStore does not manufacture updates on every render.
export function changesLspGroupSnapshot(
  snapshots: readonly EditorLspSnapshot[],
): EditorLspSnapshot {
  return (
    snapshots.find((snapshot) => snapshot.status === "unavailable") ??
    snapshots.find((snapshot) => snapshot.status === "ready") ??
    snapshots[0]!
  );
}
