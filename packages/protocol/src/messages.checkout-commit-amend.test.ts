import { describe, expect, test } from "vitest";
import {
  CheckoutCommitAmendRequestSchema,
  CheckoutCommitAmendResponseSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("checkout commit amend messages", () => {
  test("keeps the capability optional and preserves advertised support", () => {
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: {},
    });
    expect(legacy.features?.checkoutCommitAmend).toBeUndefined();

    const current = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: { checkoutCommitAmend: true },
    });
    expect(current.features?.checkoutCommitAmend).toBe(true);
  });

  test("round-trips the request through the session schema", () => {
    const request = {
      type: "checkout.commit.amend.request",
      cwd: "/workspace",
      requestId: "amend-1",
    } as const;
    expect(CheckoutCommitAmendRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("round-trips the response through the session schema", () => {
    const response = {
      type: "checkout.commit.amend.response",
      payload: {
        cwd: "/workspace",
        success: false,
        error: { code: "UNKNOWN", message: "No commit exists to amend" },
        requestId: "amend-1",
      },
    } as const;
    expect(CheckoutCommitAmendResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
