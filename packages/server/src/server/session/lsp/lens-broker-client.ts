import { createHash } from "node:crypto";
import * as net from "node:net";
import * as path from "node:path";

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

interface BrokerResponse {
  version: number;
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class LensBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LensBrokerError";
  }
}

export function lensBrokerEndpoint(workspace: string): string {
  const hash = createHash("sha256")
    .update(path.resolve(workspace).toLowerCase())
    .digest("hex")
    .slice(0, 20);
  if (process.platform === "win32") return `\\\\.\\pipe\\pi-lens-lsp-${hash}`;
  return path.join("/tmp", `pi-lens-lsp-${process.getuid?.() ?? "user"}-${hash}.sock`);
}

export class LensBrokerClient {
  private socket: net.Socket | null = null;
  private connecting: Promise<void> | null = null;
  private sequence = 0;
  private buffer = "";
  private readonly pending = new Map<string, PendingRequest>();

  constructor(readonly workspace: string) {}

  async request<T>(input: {
    method: string;
    params: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<T> {
    await this.connect();
    const id = `${process.pid}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.socket?.write(`${JSON.stringify({ version: PROTOCOL_VERSION, cancel: id })}\n`);
        reject(new LensBrokerError("timeout", `${input.method} timed out`));
      }, input.timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.socket?.write(
        `${JSON.stringify({
          version: PROTOCOL_VERSION,
          id,
          method: input.method,
          deadlineAt: Date.now() + input.timeoutMs,
          params: input.params,
        })}\n`,
      );
    });
  }

  close(): void {
    this.socket?.destroy();
    this.onDisconnect();
  }

  private async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(lensBrokerEndpoint(this.workspace));
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new LensBrokerError("connect-timeout", "Lens LSP broker did not accept a connection"),
        );
      }, 1_000);
      timer.unref?.();
      socket.setEncoding("utf8");
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new LensBrokerError("connect-error", error.message));
      });
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("close", () => this.onDisconnect());
    });
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_MESSAGE_BYTES) {
      this.socket?.destroy(new Error("Lens broker response exceeded the size limit"));
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let response: BrokerResponse;
      try {
        response = JSON.parse(line) as BrokerResponse;
      } catch {
        this.socket?.destroy(new Error("Lens broker returned malformed JSON"));
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) {
        pending.reject(new LensBrokerError(response.error.code, response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private onDisconnect(): void {
    this.socket = null;
    this.buffer = "";
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new LensBrokerError("disconnected", "Lens LSP broker disconnected"));
    }
    this.pending.clear();
  }
}

async function waitForBroker(workspace: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = new LensBrokerClient(workspace);
    try {
      await probe.request({
        method: "broker.ping",
        params: {},
        timeoutMs: 500,
      });
      probe.close();
      return;
    } catch {
      probe.close();
      if (Date.now() >= deadline) {
        throw new LensBrokerError(
          "lens-not-running",
          "Lens is not publishing an LSP server for this workspace",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function ensureLensBroker(workspace: string): Promise<void> {
  await waitForBroker(path.resolve(workspace), 800);
}
