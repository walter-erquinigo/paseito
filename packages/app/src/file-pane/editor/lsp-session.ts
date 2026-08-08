import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  WorkspaceLspCompletionItem,
  WorkspaceLspDiagnostic,
  WorkspaceLspHover,
  WorkspaceLspLocation,
  WorkspaceLspTextEdit,
} from "@getpaseo/protocol/messages";

export type EditorLspStatus = "connecting" | "ready" | "unavailable";

export interface EditorLspSessionOptions {
  client: DaemonClient;
  cwd: string;
  path: string;
  onStatus(status: EditorLspStatus): void;
}

export class EditorLspSession {
  private version = 0;
  private content = "";
  private sentContent = "";
  private opened = false;
  private opening: Promise<void> | null = null;
  private disposed = false;
  private unavailable = false;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private changePromise: Promise<void> = Promise.resolve();

  constructor(private readonly options: EditorLspSessionOptions) {}

  async open(content: string): Promise<void> {
    if (this.disposed || this.unavailable) return;
    if (this.opened) {
      this.change(content);
      return;
    }
    if (this.opening) {
      await this.opening;
      if (this.opened && content !== this.content) {
        this.change(content);
        await this.sync();
      }
      return;
    }
    this.content = content;
    this.version = 1;
    this.options.onStatus("connecting");
    this.opening = (async () => {
      try {
        await this.options.client.requestWorkspaceLsp({
          cwd: this.options.cwd,
          path: this.options.path,
          documentVersion: this.version,
          operation: { kind: "open", content },
        });
        this.opened = true;
        this.sentContent = content;
        if (this.disposed) {
          await this.closeDocument();
        } else {
          this.options.onStatus("ready");
        }
      } catch {
        this.disable();
      }
    })();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  change(content: string): void {
    if (this.disposed || this.unavailable || content === this.content) return;
    this.content = content;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      void this.sync();
    }, 150);
  }

  async diagnostics(): Promise<WorkspaceLspDiagnostic[]> {
    const version = await this.sync();
    if (version === null) return [];
    try {
      const result = await this.options.client.requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: version,
        operation: { kind: "diagnostics" },
      });
      return result.kind === "diagnostics" ? result.items : [];
    } catch {
      this.disable();
      return [];
    }
  }

  async completion(position: {
    line: number;
    character: number;
  }): Promise<{ isIncomplete: boolean; items: WorkspaceLspCompletionItem[] }> {
    const version = await this.sync();
    if (version === null) return { isIncomplete: false, items: [] };
    try {
      const result = await this.options.client.requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: version,
        operation: { kind: "completion", position },
      });
      return result.kind === "completion" ? result : { isIncomplete: false, items: [] };
    } catch {
      this.disable();
      return { isIncomplete: false, items: [] };
    }
  }

  async hover(position: { line: number; character: number }): Promise<WorkspaceLspHover | null> {
    const version = await this.sync();
    if (version === null) return null;
    try {
      const result = await this.options.client.requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: version,
        operation: { kind: "hover", position },
      });
      return result.kind === "hover" ? result.hover : null;
    } catch {
      this.disable();
      return null;
    }
  }

  async definition(position: { line: number; character: number }): Promise<WorkspaceLspLocation[]> {
    const version = await this.sync();
    if (version === null) return [];
    try {
      const result = await this.options.client.requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: version,
        operation: { kind: "definition", position },
      });
      return result.kind === "definition" ? result.locations : [];
    } catch {
      this.disable();
      return [];
    }
  }

  async format(content: string): Promise<string> {
    this.change(content);
    const version = await this.sync();
    if (version === null) return content;
    try {
      const result = await this.options.client.requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: version,
        operation: {
          kind: "formatting",
          options: {
            tabSize: 2,
            insertSpaces: true,
            trimTrailingWhitespace: true,
          },
        },
      });
      return result.kind === "formatting" ? applyTextEdits(content, result.edits) : content;
    } catch {
      return content;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    void this.closeWhenReady();
  }

  private async closeWhenReady(): Promise<void> {
    await this.opening?.catch(() => undefined);
    if (!this.opened || this.unavailable) return;
    await this.closeDocument();
  }

  private async closeDocument(): Promise<void> {
    this.opened = false;
    await this.options.client
      .requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: this.version,
        operation: { kind: "close" },
      })
      .catch(() => undefined);
  }

  private async sync(): Promise<number | null> {
    if (this.disposed || this.unavailable) return null;
    if (!this.opened) await this.open(this.content);
    if (!this.opened || this.unavailable) return null;
    if (this.content === this.sentContent) return this.version;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    const content = this.content;
    const version = this.version + 1;
    this.version = version;
    this.changePromise = this.changePromise.then(async () => {
      await this.options.client.requestWorkspaceLsp({
        cwd: this.options.cwd,
        path: this.options.path,
        documentVersion: version,
        operation: { kind: "change", content },
      });
      this.sentContent = content;
      return undefined;
    });
    try {
      await this.changePromise;
      return version;
    } catch {
      this.disable();
      return null;
    }
  }

  private disable(): void {
    this.unavailable = true;
    this.options.onStatus("unavailable");
  }
}

export function applyTextEdits(content: string, edits: WorkspaceLspTextEdit[]): string {
  const offsets = lineOffsets(content);
  const sorted = edits
    .map((edit) => ({
      from: positionOffset(content, offsets, edit.range.start.line, edit.range.start.character),
      to: positionOffset(content, offsets, edit.range.end.line, edit.range.end.character),
      newText: edit.newText,
    }))
    .sort((left, right) => right.from - left.from || right.to - left.to);
  let result = content;
  let previousFrom = content.length + 1;
  for (const edit of sorted) {
    if (edit.to > previousFrom || edit.from > edit.to)
      throw new Error("overlapping LSP text edits");
    result = `${result.slice(0, edit.from)}${edit.newText}${result.slice(edit.to)}`;
    previousFrom = edit.from;
  }
  return result;
}

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function positionOffset(
  content: string,
  offsets: number[],
  line: number,
  character: number,
): number {
  const lineStart = offsets[line];
  if (lineStart === undefined) {
    if (line === offsets.length) return content.length;
    throw new Error("LSP edit line is outside the document");
  }
  const lineEnd = content.indexOf("\n", lineStart);
  const max = lineEnd < 0 ? content.length : lineEnd;
  const offset = lineStart + character;
  if (offset > max) throw new Error("LSP edit character is outside the document line");
  return offset;
}
