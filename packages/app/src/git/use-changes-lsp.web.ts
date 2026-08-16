import { useCallback, useEffect, useMemo } from "react";
import type { WorkspaceLspLocation } from "@getpaseo/protocol/messages";
import { useWorkspaceLspPreferences } from "@/file-pane/editor/lsp-preferences";
import { ChangesLspSessionController } from "@/git/changes-lsp-controller";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import type { ChangesLspController } from "./use-changes-lsp";

const CONNECTING_SNAPSHOT = { status: "connecting", error: null, provider: null } as const;

function resolveDefinition(
  location: WorkspaceLspLocation,
  cwd: string,
): { path: string; lineStart: number; lineEnd: number } | null {
  let absolutePath: string;
  try {
    const url = new URL(location.uri);
    if (url.protocol !== "file:") return null;
    absolutePath = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
  } catch {
    return null;
  }
  const paths = resolveWorkspaceFilePaths({ path: absolutePath, workspaceRoot: cwd });
  if (!paths?.relativePath) return null;
  return {
    path: paths.relativePath,
    lineStart: location.range.start.line + 1,
    lineEnd: location.range.end.line + 1,
  };
}

export function useChangesLsp(input: {
  serverId: string;
  cwd: string;
  active: boolean;
  dirty: boolean;
  loadSource(filePath: string): Promise<string | null>;
  onOpenDefinition(location: { path: string; lineStart: number; lineEnd: number }): void;
}): ChangesLspController {
  const { serverId, cwd, active, dirty, loadSource, onOpenDefinition } = input;
  const client = useHostRuntimeClient(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceLsp === true,
  );
  const standaloneClangdSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceLspClangd === true,
  );
  const preference = useWorkspaceLspPreferences({
    serverId,
    cwd,
    language: null,
  });
  const preferenceActive = active && supported && preference.enabled && Boolean(client);
  const enabled = preferenceActive && !dirty;
  const controller = useMemo(
    () =>
      client
        ? new ChangesLspSessionController({
            client,
            cwd,
            loadSource,
            enabled: false,
            paused: false,
          })
        : null,
    [client, cwd, loadSource],
  );
  useEffect(() => {
    controller?.setActivity({ enabled: preferenceActive, paused: dirty });
  }, [controller, dirty, preferenceActive]);
  useEffect(() => () => controller?.dispose(), [controller]);

  const hover = useCallback(
    async (filePath: string, lineNumber: number, column: number) => {
      if (!enabled) return null;
      const session = await controller?.session(filePath);
      if (!session) return null;
      return session.hover({ line: lineNumber - 1, character: column - 1 });
    },
    [controller, enabled],
  );
  const definition = useCallback(
    async (filePath: string, lineNumber: number, column: number) => {
      if (!enabled) return;
      const session = await controller?.session(filePath);
      if (!session) return;
      const locations = await session.definition({ line: lineNumber - 1, character: column - 1 });
      const resolved = locations[0] ? resolveDefinition(locations[0], cwd) : null;
      if (resolved) onOpenDefinition(resolved);
    },
    [controller, cwd, enabled, onOpenDefinition],
  );
  return useMemo(
    () => ({
      enabled,
      supported,
      preferenceEnabled: preference.enabled,
      paused: dirty,
      pauseReason: dirty ? "dirty-worktree" : null,
      standaloneClangdSupported,
      setEnabled: preference.setEnabled,
      getFileSnapshot: (filePath) => controller?.getSnapshot(filePath) ?? CONNECTING_SNAPSHOT,
      subscribeFile: (filePath, listener) =>
        controller?.subscribe(filePath, listener) ?? (() => {}),
      acquireVisibleFile: (filePath) => controller?.acquireVisibleFile(filePath) ?? (() => {}),
      retry: (filePath) => void controller?.retry(filePath),
      hover,
      definition,
    }),
    [
      controller,
      definition,
      dirty,
      enabled,
      hover,
      preference.enabled,
      preference.setEnabled,
      standaloneClangdSupported,
      supported,
    ],
  );
}
