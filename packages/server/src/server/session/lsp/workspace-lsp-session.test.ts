import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

const brokerRequests: Array<{
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}> = [];
const broker = vi.hoisted(() => ({
  ensure: vi.fn(async () => undefined),
  request: vi.fn(
    async (input: { method: string; params: Record<string, unknown>; timeoutMs: number }) => {
      brokerRequests.push(input);
      if (input.method === "broker.ping") return { protocolVersion: 1 };
      if (input.method === "textDocument.definition") return [];
      return undefined;
    },
  ),
}));

vi.mock("./lens-broker-client.js", () => ({
  ensureLensBroker: broker.ensure,
  LensBrokerClient: class {
    request = broker.request;
    close() {}
  },
}));

import { WorkspaceLspSession } from "./workspace-lsp-session.js";

const directories: string[] = [];

afterEach(() => {
  brokerRequests.length = 0;
  broker.ensure.mockClear();
  broker.request.mockClear();
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
    const session = new WorkspaceLspSession({
      emit: (message) => emitted.push(message),
    });

    await session.handleRequest({
      type: "workspace.lsp.request",
      cwd,
      path: "main.cpp",
      documentVersion: 4,
      operation: { kind: "definition", position: { line: 0, character: 4 } },
      requestId: "request-1",
    });

    expect(brokerRequests.at(-1)).toEqual({
      method: "textDocument.definition",
      params: {
        file: join(cwd, "main.cpp"),
        documentVersion: 4,
        line: 0,
        character: 4,
      },
      timeoutMs: 5_000,
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
    const session = new WorkspaceLspSession({
      emit: (message) => emitted.push(message),
    });

    await session.handleRequest({
      type: "workspace.lsp.request",
      cwd,
      path: "../secret.cpp",
      documentVersion: 1,
      operation: { kind: "open", content: "secret" },
      requestId: "request-2",
    });

    expect(broker.request).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({
      type: "workspace.lsp.response",
      payload: { documentVersion: 1, result: null, requestId: "request-2" },
    });
  });
});
