import { existsSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { LensBrokerError } from "./lens-broker-client.js";
import type { WorkspaceLspClient } from "./backend.js";

const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const CLANGD_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".inc",
  ".cu",
  ".cuh",
  ".m",
  ".mm",
]);

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClangdProcess {
  stdin: Pick<Writable, "write" | "end">;
  stdout: Pick<Readable, "on">;
  stderr: Pick<Readable, "on">;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ClangdProcessHost {
  exists(file: string): boolean;
  spawn(command: string, args: string[], cwd: string): ClangdProcess;
}

const nodeClangdProcessHost: ClangdProcessHost = {
  exists: existsSync,
  spawn(command, args, cwd) {
    return spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  },
};

interface SharedClangd {
  client: ClangdClient;
  leases: number;
  documentOwners: Map<string, symbol>;
}

const sharedClients = new Map<string, SharedClangd>();

export function isClangdDocument(file: string): boolean {
  return CLANGD_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export function acquireClangdClient(workspace: string): WorkspaceLspClient {
  const key = path.resolve(workspace);
  let shared = sharedClients.get(key);
  if (!shared) {
    shared = { client: new ClangdClient(key), leases: 0, documentOwners: new Map() };
    sharedClients.set(key, shared);
  }
  shared.leases += 1;
  const lease = Symbol(key);
  const ownedDocuments = new Set<string>();
  let released = false;
  return {
    provider: "clangd" as const,
    diagnosticContext: {
      compilationDatabaseDirectory: shared.client.compilationDatabaseDirectory,
    },
    async request<T>(input: {
      method: string;
      params: Record<string, unknown>;
      timeoutMs: number;
    }): Promise<T> {
      const file = typeof input.params.file === "string" ? input.params.file : null;
      if (input.method === "document.open" && file) {
        const owner = shared.documentOwners.get(file);
        if (owner && owner !== lease) {
          throw new LensBrokerError(
            "document-owned",
            "Another Paseito editor owns this clangd document",
          );
        }
        shared.documentOwners.set(file, lease);
        ownedDocuments.add(file);
        try {
          return await shared.client.request<T>(input);
        } catch (error) {
          shared.documentOwners.delete(file);
          ownedDocuments.delete(file);
          throw error;
        }
      }
      if (file && shared.documentOwners.get(file) !== lease) {
        throw new LensBrokerError(
          "document-not-owned",
          "This editor does not own the clangd document",
        );
      }
      const result = await shared.client.request<T>(input);
      if (input.method === "document.close" && file) {
        shared.documentOwners.delete(file);
        ownedDocuments.delete(file);
      }
      return result;
    },
    close() {
      if (released) return;
      released = true;
      const closes = [...ownedDocuments].map(async (file) => {
        shared.documentOwners.delete(file);
        try {
          await shared.client.request({
            method: "document.close",
            params: { file, documentVersion: 0 },
            timeoutMs: 2_000,
          });
        } catch {
          // The process is closing; document cleanup is best effort.
        }
      });
      ownedDocuments.clear();
      shared.leases -= 1;
      if (shared.leases > 0) return;
      sharedClients.delete(key);
      void Promise.all(closes).finally(() => shared.client.close());
    },
  };
}

export class ClangdClient implements WorkspaceLspClient {
  readonly provider = "clangd" as const;
  readonly compilationDatabaseDirectory: string | null;
  private process: ClangdProcess | null = null;
  private initializePromise: Promise<void> | null = null;
  private output = Buffer.alloc(0);
  private sequence = 0;
  private closed = false;
  private stderrTail = "";
  private readonly pending = new Map<number, PendingRequest>();
  private readonly diagnosticsByUri = new Map<string, unknown[]>();
  private readonly openDocuments = new Map<string, { content: string; version: number }>();

  constructor(
    readonly workspace: string,
    private readonly host: ClangdProcessHost = nodeClangdProcessHost,
  ) {
    this.compilationDatabaseDirectory = this.resolveCompilationDatabaseDirectory();
  }

  async request<T>(input: {
    method: string;
    params: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<T> {
    await this.initialize();
    switch (input.method) {
      case "broker.ping":
        return { protocolVersion: 1, provider: "clangd" } as T;
      case "document.open":
        this.open(input.params);
        return undefined as T;
      case "document.change":
        this.change(input.params);
        return undefined as T;
      case "document.close":
        this.closeDocument(input.params);
        return undefined as T;
      case "textDocument.diagnostics":
        return this.diagnostics(input.params) as T;
      case "textDocument.completion":
        return this.completion(input.params, input.timeoutMs) as Promise<T>;
      case "textDocument.hover":
        return this.textRequest("textDocument/hover", input.params, input.timeoutMs) as Promise<T>;
      case "textDocument.definition":
        return this.definition(input.params, input.timeoutMs) as Promise<T>;
      case "textDocument.formatting":
        return this.formatting(input.params, input.timeoutMs) as Promise<T>;
      default:
        throw new LensBrokerError(
          "unsupported-method",
          `Unsupported clangd bridge method: ${input.method}`,
        );
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.process) return;
    void this.sendRequest("shutdown", null, 1_000)
      .catch(() => undefined)
      .finally(() => {
        this.sendNotification("exit", null);
        this.process?.stdin.end();
        const process = this.process;
        const killTimer = setTimeout(() => process?.kill("SIGTERM"), 1_000);
        killTimer.unref?.();
      });
  }

  private async initialize(): Promise<void> {
    if (this.closed) throw new LensBrokerError("closed", "clangd client is closed");
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      const args = ["--background-index"];
      const compilationDatabase = this.compilationDatabaseDirectory;
      if (compilationDatabase) args.push(`--compile-commands-dir=${compilationDatabase}`);
      const child = this.host.spawn("clangd", args, this.workspace);
      this.process = child;
      child.stdout.on("data", (chunk: Buffer | string) => this.onData(chunk));
      child.stderr.on("data", (chunk: Buffer | string) => {
        this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-4_096);
      });
      child.once("error", (error) => this.onExit(error));
      child.once("exit", (code, signal) => {
        const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        this.onExit(new Error(`clangd exited with ${detail}`));
      });
      await this.sendRequest(
        "initialize",
        {
          processId: process.pid,
          clientInfo: { name: "Paseito", version: "1" },
          rootUri: pathToFileURL(this.workspace).href,
          workspaceFolders: [
            { uri: pathToFileURL(this.workspace).href, name: path.basename(this.workspace) },
          ],
          capabilities: {
            textDocument: {
              completion: { completionItem: { documentationFormat: ["markdown", "plaintext"] } },
              hover: { contentFormat: ["markdown", "plaintext"] },
              publishDiagnostics: { versionSupport: true },
            },
          },
        },
        20_000,
      );
      this.sendNotification("initialized", {});
    })().catch((error) => {
      this.initializePromise = null;
      this.process?.kill("SIGTERM");
      this.process = null;
      throw error;
    });
    return this.initializePromise;
  }

  private resolveCompilationDatabaseDirectory(): string | null {
    const rootDatabase = path.join(this.workspace, "compile_commands.json");
    if (this.host.exists(rootDatabase)) return this.workspace;
    const buildDirectory = path.join(this.workspace, "build");
    if (this.host.exists(path.join(buildDirectory, "compile_commands.json"))) return buildDirectory;
    return null;
  }

  private open(params: Record<string, unknown>): void {
    const document = bridgeDocument(params);
    const languageId = languageIdForFile(document.file);
    this.openDocuments.set(document.uri, { content: document.content, version: document.version });
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: document.uri,
        languageId,
        version: document.version,
        text: document.content,
      },
    });
  }

  private change(params: Record<string, unknown>): void {
    const document = bridgeDocument(params);
    if (!this.openDocuments.has(document.uri)) {
      throw new LensBrokerError("document-not-open", "clangd document is not open");
    }
    this.openDocuments.set(document.uri, { content: document.content, version: document.version });
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri: document.uri, version: document.version },
      contentChanges: [{ text: document.content }],
    });
  }

  private closeDocument(params: Record<string, unknown>): void {
    const uri = bridgeUri(params);
    if (!this.openDocuments.delete(uri)) return;
    this.diagnosticsByUri.delete(uri);
    this.sendNotification("textDocument/didClose", { textDocument: { uri } });
  }

  private diagnostics(params: Record<string, unknown>): unknown[] {
    return this.diagnosticsByUri.get(bridgeUri(params)) ?? [];
  }

  private async completion(params: Record<string, unknown>, timeoutMs: number) {
    const response = await this.textRequest<unknown>("textDocument/completion", params, timeoutMs);
    if (Array.isArray(response)) return { isIncomplete: false, items: response };
    if (
      response &&
      typeof response === "object" &&
      Array.isArray((response as { items?: unknown }).items)
    ) {
      const list = response as { isIncomplete?: boolean; items: unknown[] };
      return { isIncomplete: list.isIncomplete === true, items: list.items };
    }
    return { isIncomplete: false, items: [] };
  }

  private async definition(params: Record<string, unknown>, timeoutMs: number) {
    const response = await this.textRequest<unknown>("textDocument/definition", params, timeoutMs);
    let locations: unknown[] = [];
    if (Array.isArray(response)) {
      locations = response;
    } else if (response) {
      locations = [response];
    }
    return locations.flatMap((location) => normalizeLocation(location));
  }

  private async formatting(params: Record<string, unknown>, timeoutMs: number) {
    const uri = bridgeUri(params);
    const options = recordValue(params.options);
    const response = await this.sendRequest(
      "textDocument/formatting",
      { textDocument: { uri }, options },
      timeoutMs,
    );
    return Array.isArray(response) ? response : [];
  }

  private textRequest<T>(method: string, params: Record<string, unknown>, timeoutMs: number) {
    const uri = bridgeUri(params);
    const line = numberValue(params.line, "line");
    const character = numberValue(params.character, "character");
    return this.sendRequest<T>(
      method,
      { textDocument: { uri }, position: { line, character } },
      timeoutMs,
    );
  }

  private sendRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (!this.process) throw new LensBrokerError("not-started", "clangd has not started");
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.sendNotification("$/cancelRequest", { id });
        reject(new LensBrokerError("timeout", `${method} timed out`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.process?.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.process?.stdin.write(body);
  }

  private onData(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.output = Buffer.concat([this.output, bytes]);
    if (this.output.length > MAX_MESSAGE_BYTES) {
      this.onExit(new Error("clangd response exceeded the size limit"));
      this.process?.kill("SIGTERM");
      return;
    }
    for (;;) {
      const headerEnd = this.output.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.output.subarray(0, headerEnd).toString("ascii");
      const lengthMatch = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i.exec(header);
      if (!lengthMatch) {
        this.onExit(new Error("clangd returned a message without Content-Length"));
        this.process?.kill("SIGTERM");
        return;
      }
      const length = Number(lengthMatch[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
        this.onExit(new Error("clangd returned an invalid Content-Length"));
        this.process?.kill("SIGTERM");
        return;
      }
      const bodyStart = headerEnd + 4;
      if (this.output.length < bodyStart + length) return;
      const body = this.output.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.output = this.output.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body) as JsonRpcResponse | JsonRpcRequest | JsonRpcNotification);
      } catch {
        this.onExit(new Error("clangd returned malformed JSON"));
        this.process?.kill("SIGTERM");
        return;
      }
    }
  }

  private onMessage(message: JsonRpcResponse | JsonRpcRequest | JsonRpcNotification): void {
    if ("method" in message) {
      if ("id" in message) {
        this.write({ jsonrpc: "2.0", id: message.id, result: serverRequestResult(message) });
        return;
      }
      if (message.method === "textDocument/publishDiagnostics") {
        const params = recordValue(message.params);
        const uri = stringValue(params.uri, "uri");
        this.diagnosticsByUri.set(uri, Array.isArray(params.diagnostics) ? params.diagnostics : []);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new LensBrokerError(
          `clangd-${message.error.code}`,
          `${pending.method} failed: ${message.error.message}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private onExit(error: Error): void {
    this.process = null;
    const stderr = this.stderrTail.trim();
    const detail = stderr ? `${error.message}: ${stderr}` : error.message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new LensBrokerError("clangd-exited", detail));
    }
    this.pending.clear();
  }
}

function bridgeDocument(params: Record<string, unknown>) {
  const file = stringValue(params.file, "file");
  return {
    file,
    uri: pathToFileURL(file).href,
    content: stringValue(params.content, "content"),
    version: numberValue(params.documentVersion, "documentVersion"),
  };
}

function bridgeUri(params: Record<string, unknown>): string {
  return pathToFileURL(stringValue(params.file, "file")).href;
}

function languageIdForFile(file: string): string {
  return path.extname(file).toLowerCase() === ".c" ? "c" : "cpp";
}

function normalizeLocation(value: unknown): Array<{ uri: string; range: unknown }> {
  const location = recordValue(value);
  if (typeof location.uri === "string" && location.range) {
    return [{ uri: location.uri, range: location.range }];
  }
  if (typeof location.targetUri === "string" && location.targetSelectionRange) {
    return [{ uri: location.targetUri, range: location.targetSelectionRange }];
  }
  return [];
}

function serverRequestResult(request: JsonRpcRequest): unknown {
  if (request.method !== "workspace/configuration") return null;
  const params = recordValue(request.params);
  return Array.isArray(params.items) ? params.items.map(() => ({})) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new LensBrokerError("invalid-request", `clangd bridge requires ${field}`);
  }
  return value;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new LensBrokerError("invalid-request", `clangd bridge requires ${field}`);
  }
  return value;
}
