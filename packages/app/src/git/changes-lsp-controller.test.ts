import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { acquireEditorLspSession } from "@/file-pane/editor/lsp-session-pool";
import { ChangesLspSessionController, changesLspErrors } from "./changes-lsp-controller";

function clientWith(
  request: (input: { operation: { kind: string } }) => Promise<unknown>,
): DaemonClient {
  return { requestWorkspaceLsp: vi.fn(request) } as unknown as DaemonClient;
}

function operationKinds(client: DaemonClient): string[] {
  return vi
    .mocked(client.requestWorkspaceLsp)
    .mock.calls.map(([request]) => request.operation.kind);
}

function operationCount(client: DaemonClient, kind: string): number {
  return operationKinds(client).filter((operation) => operation === kind).length;
}

describe("Changes LSP controller", () => {
  it("shares one session across visible header leases and closes after virtualization releases it", async () => {
    const client = clientWith(async () => ({ kind: "ack", provider: "clangd" as const }));
    const controller = new ChangesLspSessionController({
      client,
      cwd: "/repo",
      loadSource: async () => "int value;",
      enabled: true,
      paused: false,
    });
    const releaseFirst = controller.acquireVisibleFile("src/a.cc");
    const releaseSecond = controller.acquireVisibleFile("src/a.cc");
    await vi.waitFor(() => expect(controller.getSnapshot("src/a.cc").status).toBe("ready"));
    expect(operationKinds(client)).toEqual(["open"]);

    releaseFirst();
    expect(operationKinds(client)).toEqual(["open"]);
    releaseSecond();
    await vi.waitFor(() => expect(operationKinds(client)).toEqual(["open", "close"]));
    controller.dispose();
  });

  it("replays a pooled provider and retries a visible startup failure", async () => {
    let opens = 0;
    const client = clientWith(async ({ operation }) => {
      if (operation.kind !== "open") return { kind: "ack" };
      opens += 1;
      if (opens === 1) throw new Error("clangd initialize timed out");
      return { kind: "ack", provider: "clangd" as const };
    });
    const controller = new ChangesLspSessionController({
      client,
      cwd: "/repo",
      loadSource: async () => "int value;",
      enabled: true,
      paused: false,
    });
    const release = controller.acquireVisibleFile("src/a.cc");
    await vi.waitFor(() =>
      expect(controller.getSnapshot("src/a.cc")).toEqual({
        status: "unavailable",
        error: "clangd initialize timed out",
        provider: null,
      }),
    );
    await controller.retry("src/a.cc");
    expect(controller.getSnapshot("src/a.cc")).toEqual({
      status: "ready",
      error: null,
      provider: "clangd",
    });
    release();
    controller.dispose();
  });

  it("reports a stale editor buffer without replacing the editor document", async () => {
    const client = clientWith(async () => ({ kind: "ack", provider: "clangd" as const }));
    const editor = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "src/a.cc",
      content: "committed",
      onStatus() {},
    });
    await editor?.session.open("committed");
    editor?.session.change("unsaved editor content");

    const controller = new ChangesLspSessionController({
      client,
      cwd: "/repo",
      loadSource: async () => "committed",
      enabled: true,
      paused: false,
    });
    const release = controller.acquireVisibleFile("src/a.cc");
    await vi.waitFor(() =>
      expect(controller.getSnapshot("src/a.cc")).toEqual({
        status: "unavailable",
        error: changesLspErrors.staleBuffer,
        provider: null,
      }),
    );
    expect(operationKinds(client)).not.toContain("change");
    release();
    controller.dispose();
    editor?.release();
  });

  it("releases every session while dirty and resumes still-visible files when clean", async () => {
    const client = clientWith(async () => ({ kind: "ack", provider: "clangd" as const }));
    const controller = new ChangesLspSessionController({
      client,
      cwd: "/repo",
      loadSource: async (path) => `// ${path}`,
      enabled: true,
      paused: false,
    });
    const releaseA = controller.acquireVisibleFile("a.cc");
    const releaseB = controller.acquireVisibleFile("b.cc");
    await vi.waitFor(() => expect(operationCount(client, "open")).toBe(2));

    controller.setActivity({ enabled: true, paused: true });
    expect(await controller.session("a.cc")).toBeNull();
    await vi.waitFor(() => expect(operationCount(client, "close")).toBe(2));

    controller.setActivity({ enabled: true, paused: false });
    await vi.waitFor(() => expect(operationCount(client, "open")).toBe(4));
    expect(controller.getSnapshot("a.cc").provider).toBe("clangd");
    expect(controller.getSnapshot("b.cc").provider).toBe("clangd");
    releaseA();
    releaseB();
    controller.dispose();
  });
});
