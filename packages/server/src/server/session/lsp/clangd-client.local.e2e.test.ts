import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { ClangdClient } from "./clangd-client.js";
import { WorkspaceLspSession } from "./workspace-lsp-session.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ClangdClient with real clangd", () => {
  test("returns hover information and the definition for an open C++ document", async () => {
    const { workspace, file, content } = createCppWorkspace();
    const client = new ClangdClient(workspace);

    try {
      await client.request({
        method: "document.open",
        params: { file, content, documentVersion: 1 },
        timeoutMs: 20_000,
      });
      const hover = await client.request({
        method: "textDocument.hover",
        params: { file, documentVersion: 1, line: 1, character: 21 },
        timeoutMs: 5_000,
      });
      const locations = await client.request<Array<{ uri: string; range: unknown }>>({
        method: "textDocument.definition",
        params: { file, documentVersion: 1, line: 1, character: 21 },
        timeoutMs: 5_000,
      });

      expect(JSON.stringify(hover)).toContain("add");
      expect(locations).toMatchObject([
        {
          uri: pathToFileURL(file).href,
          range: { start: { line: 0 } },
        },
      ]);
    } finally {
      client.close();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }, 20_000);

  test("falls back from an absent Lens broker through the workspace session", async () => {
    const { workspace, content } = createCppWorkspace();
    const emitted: SessionOutboundMessage[] = [];
    const session = new WorkspaceLspSession({ emit: (message) => emitted.push(message) });

    try {
      await session.handleRequest({
        type: "workspace.lsp.request",
        cwd: workspace,
        path: "main.cpp",
        documentVersion: 1,
        operation: { kind: "open", content },
        requestId: "open",
      });
      await session.handleRequest({
        type: "workspace.lsp.request",
        cwd: workspace,
        path: "main.cpp",
        documentVersion: 1,
        operation: { kind: "hover", position: { line: 1, character: 21 } },
        requestId: "hover",
      });
      await session.handleRequest({
        type: "workspace.lsp.request",
        cwd: workspace,
        path: "main.cpp",
        documentVersion: 1,
        operation: { kind: "definition", position: { line: 1, character: 21 } },
        requestId: "definition",
      });

      expect(emitted).toMatchObject([
        { payload: { requestId: "open", result: { kind: "ack" }, error: null } },
        { payload: { requestId: "hover", result: { kind: "hover" }, error: null } },
        {
          payload: {
            requestId: "definition",
            result: {
              kind: "definition",
              locations: [{ range: { start: { line: 0 } } }],
            },
            error: null,
          },
        },
      ]);
    } finally {
      session.dispose();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }, 20_000);
});

function createCppWorkspace() {
  const workspace = realpathSync(resolve(mkdtempSync(join(tmpdir(), "paseito-clangd-"))));
  directories.push(workspace);
  const file = join(workspace, "main.cpp");
  const content = [
    "int add(int left, int right) { return left + right; }",
    "int main() { return add(1, 2); }",
    "",
  ].join("\n");
  writeFileSync(file, content);
  writeFileSync(
    join(workspace, "compile_commands.json"),
    JSON.stringify([
      {
        directory: workspace,
        file,
        arguments: ["/usr/bin/clang++", "-std=c++20", "-c", file],
      },
    ]),
  );
  return { workspace, file, content };
}
