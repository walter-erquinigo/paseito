import { describe, expect, test, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { applyTextEdits, EditorLspSession, type EditorLspSnapshot } from "./lsp-session";

describe("applyTextEdits", () => {
  test("applies non-overlapping UTF-16 edits in one deterministic result", () => {
    expect(
      applyTextEdits("alpha\nbeta\n", [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          newText: "ALPHA",
        },
        {
          range: {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 4 },
          },
          newText: "!",
        },
      ]),
    ).toBe("ALPHA\nbeta!\n");
  });

  test("rejects overlapping or out-of-bounds edits", () => {
    expect(() =>
      applyTextEdits("abc", [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          newText: "x",
        },
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 3 },
          },
          newText: "y",
        },
      ]),
    ).toThrow("overlapping");
    expect(() =>
      applyTextEdits("abc", [
        {
          range: {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 0 },
          },
          newText: "x",
        },
      ]),
    ).toThrow("outside");
  });
});

describe("EditorLspSession", () => {
  test("coalesces concurrent opens and closes a lease after disposal", async () => {
    let releaseOpen: (() => void) | undefined;
    const openPending = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const requestWorkspaceLsp = vi.fn(async (request: { operation: { kind: string } }) => {
      if (request.operation.kind === "open") await openPending;
      return { kind: "ack" } as const;
    });
    const statuses: string[] = [];
    const session = new EditorLspSession({
      client: { requestWorkspaceLsp } as unknown as DaemonClient,
      cwd: "/repo",
      path: "main.cpp",
      onStatus: (snapshot) => statuses.push(snapshot.status),
    });

    const first = session.open("int main() {}\n");
    const second = session.open("int main() {}\n");
    session.dispose();
    releaseOpen?.();
    await Promise.all([first, second]);

    expect(requestWorkspaceLsp.mock.calls.map(([request]) => request.operation.kind)).toEqual([
      "open",
      "close",
    ]);
    expect(statuses).toEqual(["connecting"]);
  });

  test("formatting failure saves unchanged without disabling other editor behavior", async () => {
    const requestWorkspaceLsp = vi.fn(async (request: { operation: { kind: string } }) => {
      if (request.operation.kind === "formatting") throw new Error("formatter timeout");
      if (request.operation.kind === "hover") return { kind: "hover", hover: null } as const;
      return { kind: "ack" } as const;
    });
    const statuses: string[] = [];
    const session = new EditorLspSession({
      client: { requestWorkspaceLsp } as unknown as DaemonClient,
      cwd: "/repo",
      path: "main.cpp",
      onStatus: (snapshot) => statuses.push(snapshot.status),
    });

    await session.open("int main() {}\n");
    await expect(session.format("int main() {}\n")).resolves.toBe("int main() {}\n");
    await expect(session.hover({ line: 0, character: 4 })).resolves.toBeNull();
    expect(statuses).toEqual(["connecting", "ready"]);
  });

  test("a transient hover timeout does not permanently disable the session", async () => {
    let hoverAttempts = 0;
    const requestWorkspaceLsp = vi.fn(async (request: { operation: { kind: string } }) => {
      if (request.operation.kind !== "hover") return { kind: "ack" } as const;
      hoverAttempts += 1;
      if (hoverAttempts === 1) throw new Error("hover timed out");
      return {
        kind: "hover",
        hover: { contents: { kind: "plaintext", value: "int answer" } },
      } as const;
    });
    const statuses: string[] = [];
    const session = new EditorLspSession({
      client: { requestWorkspaceLsp } as unknown as DaemonClient,
      cwd: "/repo",
      path: "main.cpp",
      onStatus: (snapshot) => statuses.push(snapshot.status),
    });

    await session.open("int answer;\n");
    await expect(session.hover({ line: 0, character: 4 })).resolves.toBeNull();
    await expect(session.hover({ line: 0, character: 4 })).resolves.toMatchObject({
      contents: { value: "int answer" },
    });
    expect(statuses).toEqual(["connecting", "ready"]);
  });

  test("keeps the initial failure visible and retries the same document", async () => {
    let openAttempts = 0;
    const requestWorkspaceLsp = vi.fn(async (request: { operation: { kind: string } }) => {
      if (request.operation.kind !== "open") return { kind: "ack" } as const;
      openAttempts += 1;
      if (openAttempts === 1) throw new Error("spawn clangd ENOENT");
      return { kind: "ack", provider: "clangd" as const };
    });
    const snapshots: EditorLspSnapshot[] = [];
    const session = new EditorLspSession({
      client: { requestWorkspaceLsp } as unknown as DaemonClient,
      cwd: "/repo",
      path: "main.cpp",
      onStatus: (snapshot) => snapshots.push(snapshot),
    });

    await session.open("int main() {}\n");
    expect(session.getSnapshot()).toEqual({
      status: "unavailable",
      error: "spawn clangd ENOENT",
      provider: null,
    });

    await session.retry();
    expect(session.getSnapshot()).toEqual({
      status: "ready",
      error: null,
      provider: "clangd",
    });
    expect(snapshots).toEqual([
      { status: "connecting", error: null, provider: null },
      { status: "unavailable", error: "spawn clangd ENOENT", provider: null },
      { status: "connecting", error: null, provider: null },
      { status: "ready", error: null, provider: "clangd" },
    ]);
  });
});
