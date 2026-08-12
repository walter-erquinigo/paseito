import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { WorkspaceLspBackendFactory, WorkspaceLspClient } from "./backend.js";
import { WorkspaceLspSession } from "./workspace-lsp-session.js";

interface BackendRequest {
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}

class RecordingBackend implements WorkspaceLspClient {
  readonly requests: BackendRequest[] = [];

  async request<T>(input: BackendRequest): Promise<T> {
    this.requests.push(input);
    if (input.method === "textDocument.definition") return [] as T;
    return undefined as T;
  }

  close() {}
}

function backendFactory(backend: RecordingBackend): WorkspaceLspBackendFactory {
  return { connect: async () => backend };
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "paseito-lsp-")));
  directories.push(directory);
  writeFileSync(join(directory, "main.cpp"), "int main() {}\n");
  return directory;
}

describe("WorkspaceLspSession", () => {
  test("confines a request and preserves its document version", async () => {
    const cwd = workspace();
    const emitted: SessionOutboundMessage[] = [];
    const backend = new RecordingBackend();
    const session = new WorkspaceLspSession(
      { emit: (message) => emitted.push(message) },
      backendFactory(backend),
    );

    await session.handleRequest({
      type: "workspace.lsp.request",
      cwd,
      path: "main.cpp",
      documentVersion: 4,
      operation: { kind: "definition", position: { line: 0, character: 4 } },
      requestId: "request-1",
    });

    expect(backend.requests.at(-1)).toEqual({
      method: "textDocument.definition",
      params: {
        file: join(cwd, "main.cpp"),
        documentVersion: 4,
        line: 0,
        character: 4,
      },
      timeoutMs: 15_000,
    });
    expect(emitted).toEqual([
      {
        type: "workspace.lsp.response",
        payload: {
          documentVersion: 4,
          result: { kind: "definition", locations: [] },
          error: null,
          requestId: "request-1",
        },
      },
    ]);
  });

  test("rejects paths outside the workspace before contacting the broker", async () => {
    const cwd = workspace();
    const emitted: SessionOutboundMessage[] = [];
    const backend = new RecordingBackend();
    const session = new WorkspaceLspSession(
      { emit: (message) => emitted.push(message) },
      backendFactory(backend),
    );

    await session.handleRequest({
      type: "workspace.lsp.request",
      cwd,
      path: "../secret.cpp",
      documentVersion: 1,
      operation: { kind: "open", content: "secret" },
      requestId: "request-2",
    });

    expect(backend.requests).toEqual([]);
    expect(emitted[0]).toMatchObject({
      type: "workspace.lsp.response",
      payload: { documentVersion: 1, result: null, requestId: "request-2" },
    });
  });
});
