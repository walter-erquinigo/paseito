import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { ClangdClient, type ClangdProcessHost } from "./clangd-client.js";

class FakeClangdProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writes: Array<Record<string, unknown>> = [];
  private input = Buffer.alloc(0);
  private readonly listeners = {
    error: [] as Array<(error: Error) => void>,
    exit: [] as Array<(code: number | null, signal: NodeJS.Signals | null) => void>,
  };

  constructor() {
    this.stdin.on("data", (chunk: Buffer) => this.onInput(chunk));
  }

  once(event: "error" | "exit", listener: (...args: never[]) => void): this {
    if (event === "error") this.listeners.error.push(listener as (error: Error) => void);
    else
      this.listeners.exit.push(
        listener as (code: number | null, signal: NodeJS.Signals | null) => void,
      );
    return this;
  }

  kill(): boolean {
    return true;
  }

  respond(id: number, result: unknown): void {
    this.emit({ jsonrpc: "2.0", id, result });
  }

  notify(method: string, params: unknown): void {
    this.emit({ jsonrpc: "2.0", method, params });
  }

  private onInput(chunk: Buffer): void {
    this.input = Buffer.concat([this.input, chunk]);
    for (;;) {
      const headerEnd = this.input.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.input.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) throw new Error("missing content length");
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.input.length < bodyStart + length) return;
      const body = this.input.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.input = this.input.subarray(bodyStart + length);
      const message = JSON.parse(body) as Record<string, unknown>;
      this.writes.push(message);
      if (message.method === "initialize") this.respond(message.id as number, { capabilities: {} });
    }
  }

  private emit(message: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(message));
    this.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.stdout.write(body);
  }
}

function setup() {
  const process = new FakeClangdProcess();
  const launches: Array<{ command: string; args: string[]; cwd: string }> = [];
  const host: ClangdProcessHost = {
    exists: (file) => file === "/repo/build/compile_commands.json",
    spawn(command, args, cwd) {
      launches.push({ command, args, cwd });
      return process;
    },
  };
  return { client: new ClangdClient("/repo", host), launches, process };
}

describe("ClangdClient", () => {
  test("starts clangd with the workspace compilation database and opens the document", async () => {
    const { client, launches, process } = setup();

    await client.request({
      method: "document.open",
      params: { file: "/repo/main.cpp", content: "int main() {}\n", documentVersion: 1 },
      timeoutMs: 20_000,
    });

    expect(launches).toEqual([
      {
        command: "clangd",
        args: ["--background-index", "--compile-commands-dir=/repo/build"],
        cwd: "/repo",
      },
    ]);
    expect(process.writes.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "textDocument/didOpen",
    ]);
  });

  test("returns clangd hover, definitions, and pushed diagnostics", async () => {
    const { client, process } = setup();
    await client.request({
      method: "document.open",
      params: { file: "/repo/main.cpp", content: "int value;\n", documentVersion: 1 },
      timeoutMs: 20_000,
    });
    process.notify("textDocument/publishDiagnostics", {
      uri: "file:///repo/main.cpp",
      diagnostics: [{ severity: 2, message: "warning", range: range(0, 0, 0, 3) }],
    });

    const hoverPromise = client.request({
      method: "textDocument.hover",
      params: { file: "/repo/main.cpp", documentVersion: 1, line: 0, character: 5 },
      timeoutMs: 3_000,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const hoverRequest = process.writes.at(-1)!;
    process.respond(hoverRequest.id as number, {
      contents: { kind: "markdown", value: "`int value`" },
    });

    const definitionPromise = client.request({
      method: "textDocument.definition",
      params: { file: "/repo/main.cpp", documentVersion: 1, line: 0, character: 5 },
      timeoutMs: 5_000,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const definitionRequest = process.writes.at(-1)!;
    process.respond(definitionRequest.id as number, {
      targetUri: "file:///repo/value.h",
      targetSelectionRange: range(3, 1, 3, 6),
    });

    await expect(hoverPromise).resolves.toEqual({
      contents: { kind: "markdown", value: "`int value`" },
    });
    await expect(definitionPromise).resolves.toEqual([
      { uri: "file:///repo/value.h", range: range(3, 1, 3, 6) },
    ]);
    await expect(
      client.request({
        method: "textDocument.diagnostics",
        params: { file: "/repo/main.cpp", documentVersion: 1 },
        timeoutMs: 2_000,
      }),
    ).resolves.toEqual([{ severity: 2, message: "warning", range: range(0, 0, 0, 3) }]);
  });
});

function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}
