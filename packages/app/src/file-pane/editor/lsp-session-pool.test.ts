import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { acquireEditorLspSession } from "./lsp-session-pool";
import type { EditorLspSnapshot } from "./lsp-session";

describe("editor LSP session pool", () => {
  it("shares matching documents and rejects a stale competing buffer", async () => {
    const requestWorkspaceLsp = vi.fn(async () => ({ kind: "ack" as const }));
    const client = { requestWorkspaceLsp } as unknown as DaemonClient;
    const first = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "a.cc",
      content: "same",
      onStatus: vi.fn(),
    });
    const second = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "a.cc",
      content: "same",
      onStatus: vi.fn(),
    });
    expect(second?.session).toBe(first?.session);
    await first?.session.open("same");
    first?.session.change("unsaved");
    expect(
      acquireEditorLspSession({
        client,
        cwd: "/repo",
        path: "a.cc",
        content: "same",
        onStatus: vi.fn(),
      }),
    ).toBeNull();
    first?.release();
    expect(requestWorkspaceLsp).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: { kind: "close" } }),
    );
    second?.release();
  });

  it("replays a failed pooled session to a late editor lease", async () => {
    let openAttempts = 0;
    const requestWorkspaceLsp = vi.fn(async (request: { operation: { kind: string } }) => {
      if (request.operation.kind !== "open") return { kind: "ack" } as const;
      openAttempts += 1;
      if (openAttempts === 1) throw new Error("clangd initialize timed out");
      return { kind: "ack", provider: "clangd" as const };
    });
    const client = { requestWorkspaceLsp } as unknown as DaemonClient;
    const changesSnapshots: EditorLspSnapshot[] = [];
    const changes = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "a.cc",
      content: "same",
      onStatus: (snapshot) => changesSnapshots.push(snapshot),
    });
    await changes?.session.open("same");

    const editorSnapshots: EditorLspSnapshot[] = [];
    const editor = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "a.cc",
      content: "same",
      onStatus: (snapshot) => editorSnapshots.push(snapshot),
    });
    expect(editor?.session).toBe(changes?.session);
    expect(editorSnapshots).toEqual([
      { status: "unavailable", error: "clangd initialize timed out", provider: null },
    ]);

    await editor?.session.retry();
    expect(changesSnapshots.at(-1)).toEqual({
      status: "ready",
      error: null,
      provider: "clangd",
    });
    expect(editorSnapshots.at(-1)).toEqual({
      status: "ready",
      error: null,
      provider: "clangd",
    });
    changes?.release();
    editor?.release();
  });

  it("replays a ready pooled session to a late editor lease", async () => {
    const client = {
      requestWorkspaceLsp: vi.fn(async () => ({
        kind: "ack" as const,
        provider: "clangd" as const,
      })),
    } as unknown as DaemonClient;
    const changes = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "ready.cc",
      content: "same",
      onStatus() {},
    });
    await changes?.session.open("same");

    const editorSnapshots: EditorLspSnapshot[] = [];
    const editor = acquireEditorLspSession({
      client,
      cwd: "/repo",
      path: "ready.cc",
      content: "same",
      onStatus: (snapshot) => editorSnapshots.push(snapshot),
    });
    expect(editorSnapshots).toEqual([{ status: "ready", error: null, provider: "clangd" }]);
    changes?.release();
    editor?.release();
  });
});
