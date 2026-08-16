import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { acquireEditorLspSession } from "./lsp-session-pool";

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
});
