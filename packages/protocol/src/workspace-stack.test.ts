import { expect, test } from "vitest";
import {
  WorkspaceStackListRequestSchema,
  WorkspaceStackListResponseSchema,
  WorkspaceStackGetChangeRequestResponseSchema,
  SessionOutboundMessageSchema,
  ServerInfoStatusPayloadSchema,
} from "./messages.js";

test("old server info remains valid without the new capability", () => {
  const legacy = ServerInfoStatusPayloadSchema.parse({
    status: "server_info",
    serverId: "host",
    features: {},
  });
  expect(legacy.features?.workspaceStack).toBeUndefined();
  const current = ServerInfoStatusPayloadSchema.parse({
    status: "server_info",
    serverId: "host",
    features: { workspaceStack: true },
  });
  expect(current.features?.workspaceStack).toBe(true);
});

test("stack RPCs carry correlated results and explicit errors", () => {
  expect(
    WorkspaceStackListRequestSchema.parse({
      type: "checkout.stack.list.request",
      cwd: "/project",
      requestId: "list",
    }),
  ).toEqual({ type: "checkout.stack.list.request", cwd: "/project", requestId: "list" });
  const response = {
    type: "checkout.stack.list.response",
    payload: {
      cwd: "/project",
      requestId: "list",
      stack: {
        prefix: "feature",
        currentBranch: "dev/feature-a-test",
        branches: [
          {
            name: "dev/feature-a-test",
            sha: "a".repeat(40),
            index: "a",
            parent: "main",
            subject: "Test",
          },
        ],
      },
      error: null,
    },
  };
  expect(WorkspaceStackListResponseSchema.parse(response)).toEqual(response);
  expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  const link = {
    type: "checkout.stack.get_change_request.response",
    payload: {
      cwd: "/project",
      requestId: "link",
      changeRequest: { number: 42, url: "https://gitlab.example/project/-/merge_requests/42" },
      error: null,
    },
  };
  expect(WorkspaceStackGetChangeRequestResponseSchema.parse(link)).toEqual(link);
});
