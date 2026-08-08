import { describe, expect, test, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { applyTextEdits, EditorLspSession } from "./lsp-session";

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
      onStatus: (status) => statuses.push(status),
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
      onStatus: (status) => statuses.push(status),
    });

    await session.open("int main() {}\n");
    await expect(session.format("int main() {}\n")).resolves.toBe("int main() {}\n");
    await expect(session.hover({ line: 0, character: 4 })).resolves.toBeNull();
    expect(statuses).toEqual(["connecting", "ready"]);
  });
});
