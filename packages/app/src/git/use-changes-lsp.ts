import { useMemo } from "react";
import type { EditorLspSnapshot } from "@/file-pane/editor/lsp-session";

const CONNECTING_SNAPSHOT: EditorLspSnapshot = {
  status: "connecting",
  error: null,
  provider: null,
};

export interface ChangesLspController {
  enabled: boolean;
  supported: boolean;
  preferenceEnabled: boolean;
  paused: boolean;
  pauseReason: "dirty-worktree" | null;
  standaloneClangdSupported: boolean;
  setEnabled(enabled: boolean): void;
  getFileSnapshot(filePath: string): EditorLspSnapshot;
  subscribeFile(filePath: string, listener: () => void): () => void;
  acquireVisibleFile(filePath: string): () => void;
  retry(filePath: string): void;
  hover(filePath: string, lineNumber: number, column: number): Promise<string | null>;
  definition(filePath: string, lineNumber: number, column: number): Promise<void>;
}

export function useChangesLsp(_input: {
  serverId: string;
  cwd: string;
  active: boolean;
  dirty: boolean;
  loadSource(filePath: string): Promise<string | null>;
  onOpenDefinition(location: { path: string; lineStart: number; lineEnd: number }): void;
}): ChangesLspController {
  return useMemo(
    () => ({
      enabled: false,
      supported: false,
      preferenceEnabled: false,
      paused: false,
      pauseReason: null,
      standaloneClangdSupported: false,
      setEnabled() {},
      getFileSnapshot: () => CONNECTING_SNAPSHOT,
      subscribeFile: () => () => {},
      acquireVisibleFile: () => () => {},
      retry() {},
      hover: async () => null,
      definition: async () => undefined,
    }),
    [],
  );
}
