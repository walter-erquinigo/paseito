import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { LspStatusMenu } from "@/file-pane/lsp-status-menu";
import {
  changesLspGroupSnapshot,
  groupChangesLspFiles,
  type ChangesLspGroup,
} from "@/git/changes-lsp-groups";
import type { ChangesLspController } from "@/git/use-changes-lsp";
import type { ParsedDiffFile } from "@/git/use-diff-query";

export function ChangesLspToolbar({
  files,
  lsp,
  compact,
}: {
  files: readonly ParsedDiffFile[];
  lsp: ChangesLspController;
  compact: boolean;
}) {
  const groups = useMemo(() => groupChangesLspFiles(files), [files]);
  if (!lsp.supported) return null;
  return (
    <>
      {groups.map((group) => (
        <ChangesLspGroupMenu key={group.language} group={group} lsp={lsp} compact={compact} />
      ))}
    </>
  );
}

function ChangesLspGroupMenu({
  group,
  lsp,
  compact,
}: {
  group: ChangesLspGroup;
  lsp: ChangesLspController;
  compact: boolean;
}) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const releases = group.paths.map((path) => lsp.subscribeFile(path, listener));
      return () => releases.forEach((release) => release());
    },
    [group.paths, lsp],
  );
  const getSnapshot = useCallback(
    () => changesLspGroupSnapshot(group.paths.map((path) => lsp.getFileSnapshot(path))),
    [group.paths, lsp],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Keep one representative document per language so the toolbar can connect and
  // retry even when all its files are collapsed or outside the virtualized viewport.
  const representative = group.paths[0]!;
  useEffect(() => lsp.acquireVisibleFile(representative), [lsp, representative]);
  const retry = useCallback(() => {
    for (const path of group.paths) lsp.retry(path);
  }, [group.paths, lsp]);
  return (
    <LspStatusMenu
      enabled={lsp.preferenceEnabled}
      snapshot={snapshot}
      language={group.language}
      languageLabel={group.language === "cpp" ? "C/C++" : "Python"}
      standaloneClangdSupported={lsp.standaloneClangdSupported}
      onEnabledChange={lsp.setEnabled}
      onRetry={retry}
      presentation={compact ? "icon" : "label"}
      testIDPrefix={`changes-lsp-${group.language}`}
    />
  );
}
