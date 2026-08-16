import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { EditorLspSession, type EditorLspSnapshot } from "@/file-pane/editor/lsp-session";

interface PooledSession {
  session: EditorLspSession;
  initialContent: string;
  leases: number;
  statusListeners: Set<(snapshot: EditorLspSnapshot) => void>;
}

export interface EditorLspLease {
  session: EditorLspSession;
  release(): void;
}

const pools = new WeakMap<DaemonClient, Map<string, PooledSession>>();

export function acquireEditorLspSession(input: {
  client: DaemonClient;
  cwd: string;
  path: string;
  content: string;
  onStatus(snapshot: EditorLspSnapshot): void;
}): EditorLspLease | null {
  let pool = pools.get(input.client);
  if (!pool) {
    pool = new Map();
    pools.set(input.client, pool);
  }
  const key = `${input.cwd}\u0000${input.path}`;
  let entry = pool.get(key);
  if (
    entry &&
    !entry.session.matchesContent(input.content) &&
    (entry.session.hasStarted() || entry.initialContent !== input.content)
  ) {
    return null;
  }
  const existingEntry = Boolean(entry);
  if (!entry) {
    const statusListeners = new Set<(snapshot: EditorLspSnapshot) => void>();
    entry = {
      leases: 0,
      initialContent: input.content,
      statusListeners,
      session: new EditorLspSession({
        client: input.client,
        cwd: input.cwd,
        path: input.path,
        onStatus(status) {
          for (const listener of statusListeners) listener(status);
        },
      }),
    };
    pool.set(key, entry);
  }
  entry.leases += 1;
  entry.statusListeners.add(input.onStatus);
  if (existingEntry) input.onStatus(entry.session.getSnapshot());
  let released = false;
  return {
    session: entry.session,
    release() {
      if (released) return;
      released = true;
      entry?.statusListeners.delete(input.onStatus);
      if (!entry) return;
      entry.leases -= 1;
      if (entry.leases > 0) return;
      entry.session.dispose();
      pool?.delete(key);
    },
  };
}
