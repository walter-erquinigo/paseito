import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { EditorLspSnapshot, EditorLspSession } from "@/file-pane/editor/lsp-session";
import { acquireEditorLspSession, type EditorLspLease } from "@/file-pane/editor/lsp-session-pool";

const CONNECTING_SNAPSHOT: EditorLspSnapshot = {
  status: "connecting",
  error: null,
  provider: null,
};

const STALE_BUFFER_ERROR =
  "LSP is unavailable because unsaved editor changes differ from this Changes revision.";
const SOURCE_UNAVAILABLE_ERROR = "LSP could not load this file's selected revision.";

interface FileEntry {
  visibleLeases: number;
  lease: EditorLspLease | null;
  loading: Promise<EditorLspSession | null> | null;
  generation: number;
  snapshot: EditorLspSnapshot;
  listeners: Set<() => void>;
}

export interface ChangesLspSessionControllerOptions {
  client: DaemonClient;
  cwd: string;
  loadSource(filePath: string): Promise<string | null>;
  enabled: boolean;
  paused: boolean;
}

export class ChangesLspSessionController {
  private readonly entries = new Map<string, FileEntry>();
  private enabled: boolean;
  private paused: boolean;
  private disposed = false;

  constructor(private readonly options: ChangesLspSessionControllerOptions) {
    this.enabled = options.enabled;
    this.paused = options.paused;
  }

  setActivity(input: { enabled: boolean; paused: boolean }): void {
    if (this.disposed) return;
    const wasActive = this.isActive();
    this.enabled = input.enabled;
    this.paused = input.paused;
    const active = this.isActive();
    if (wasActive === active) return;
    if (!active) {
      for (const entry of this.entries.values()) this.releaseSession(entry);
      return;
    }
    for (const [filePath, entry] of this.entries) {
      if (entry.visibleLeases > 0) void this.ensureSession(filePath, entry);
    }
  }

  acquireVisibleFile(filePath: string): () => void {
    const entry = this.entry(filePath);
    entry.visibleLeases += 1;
    if (this.isActive()) void this.ensureSession(filePath, entry);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.visibleLeases = Math.max(0, entry.visibleLeases - 1);
      if (entry.visibleLeases === 0) this.releaseSession(entry);
    };
  }

  getSnapshot(filePath: string): EditorLspSnapshot {
    return this.entries.get(filePath)?.snapshot ?? CONNECTING_SNAPSHOT;
  }

  subscribe(filePath: string, listener: () => void): () => void {
    const entry = this.entry(filePath);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  async retry(filePath: string): Promise<void> {
    if (!this.isActive()) return;
    const entry = this.entry(filePath);
    if (entry.visibleLeases === 0) return;
    if (entry.lease) {
      await entry.lease.session.retry();
      return;
    }
    this.publish(entry, CONNECTING_SNAPSHOT);
    await this.ensureSession(filePath, entry);
  }

  async session(filePath: string): Promise<EditorLspSession | null> {
    if (!this.isActive()) return null;
    const entry = this.entries.get(filePath);
    if (!entry || entry.visibleLeases === 0) return null;
    return this.ensureSession(filePath, entry);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) this.releaseSession(entry);
    this.entries.clear();
  }

  private isActive(): boolean {
    return !this.disposed && this.enabled && !this.paused;
  }

  private entry(filePath: string): FileEntry {
    let entry = this.entries.get(filePath);
    if (!entry) {
      entry = {
        visibleLeases: 0,
        lease: null,
        loading: null,
        generation: 0,
        snapshot: CONNECTING_SNAPSHOT,
        listeners: new Set(),
      };
      this.entries.set(filePath, entry);
    }
    return entry;
  }

  private ensureSession(filePath: string, entry: FileEntry): Promise<EditorLspSession | null> {
    if (!this.isActive() || entry.visibleLeases === 0) return Promise.resolve(null);
    if (entry.lease) return Promise.resolve(entry.lease.session);
    if (entry.loading) return entry.loading;
    const generation = entry.generation;
    this.publish(entry, CONNECTING_SNAPSHOT);
    entry.loading = (async () => {
      let source: string | null;
      try {
        source = await this.options.loadSource(filePath);
      } catch (error) {
        if (generation === entry.generation) {
          this.publish(entry, {
            status: "unavailable",
            error: error instanceof Error ? error.message : String(error),
            provider: null,
          });
        }
        return null;
      }
      if (generation !== entry.generation || !this.isActive() || entry.visibleLeases === 0) {
        return null;
      }
      if (source === null) {
        this.publish(entry, {
          status: "unavailable",
          error: SOURCE_UNAVAILABLE_ERROR,
          provider: null,
        });
        return null;
      }
      const lease = acquireEditorLspSession({
        client: this.options.client,
        cwd: this.options.cwd,
        path: filePath,
        content: source,
        onStatus: (snapshot) => {
          if (generation === entry.generation) this.publish(entry, snapshot);
        },
      });
      if (!lease) {
        this.publish(entry, {
          status: "unavailable",
          error: STALE_BUFFER_ERROR,
          provider: null,
        });
        return null;
      }
      if (generation !== entry.generation || !this.isActive() || entry.visibleLeases === 0) {
        lease.release();
        return null;
      }
      entry.lease = lease;
      await lease.session.open(source);
      return lease.session.matchesContent(source) ? lease.session : null;
    })().finally(() => {
      if (generation === entry.generation) entry.loading = null;
    });
    return entry.loading;
  }

  private releaseSession(entry: FileEntry): void {
    entry.generation += 1;
    entry.loading = null;
    entry.lease?.release();
    entry.lease = null;
    this.publish(entry, CONNECTING_SNAPSHOT);
  }

  private publish(entry: FileEntry, snapshot: EditorLspSnapshot): void {
    if (
      entry.snapshot.status === snapshot.status &&
      entry.snapshot.error === snapshot.error &&
      entry.snapshot.provider === snapshot.provider
    ) {
      return;
    }
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  }
}

export const changesLspErrors = {
  sourceUnavailable: SOURCE_UNAVAILABLE_ERROR,
  staleBuffer: STALE_BUFFER_ERROR,
};
