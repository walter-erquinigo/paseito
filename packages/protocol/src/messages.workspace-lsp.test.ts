import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("workspace LSP protocol", () => {
  test("parses a versioned editor request", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "workspace.lsp.request",
      cwd: "/repo",
      path: "src/main.cpp",
      documentVersion: 7,
      operation: { kind: "completion", position: { line: 3, character: 9 } },
      requestId: "lsp-1",
    });
    expect(parsed.type).toBe("workspace.lsp.request");
  });

  test("rejects invalid positions and accepts normalized edit responses", () => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "workspace.lsp.request",
        cwd: "/repo",
        path: "main.py",
        documentVersion: 1,
        operation: { kind: "hover", position: { line: -1, character: 0 } },
        requestId: "lsp-bad",
      }),
    ).toThrow();

    const parsed = SessionOutboundMessageSchema.parse({
      type: "workspace.lsp.response",
      payload: {
        documentVersion: 2,
        result: {
          kind: "formatting",
          edits: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 4 },
              },
              newText: "int",
            },
          ],
        },
        error: null,
        requestId: "lsp-2",
      },
    });
    expect(parsed.type).toBe("workspace.lsp.response");
  });
});
