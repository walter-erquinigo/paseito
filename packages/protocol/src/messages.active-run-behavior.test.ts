import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema } from "./messages.js";

function request(activeRunBehavior?: "replace" | "steer") {
  return {
    type: "send_agent_message_request" as const,
    requestId: "request-1",
    agentId: "agent-1",
    messageId: "message-1",
    text: "change direction",
    ...(activeRunBehavior ? { activeRunBehavior } : {}),
  };
}

describe("send_agent_message_request active run behavior", () => {
  test("preserves an explicit steering request", () => {
    expect(SessionInboundMessageSchema.parse(request("steer"))).toMatchObject({
      activeRunBehavior: "steer",
    });
  });

  test("keeps legacy requests omitted so the server can retain replacement semantics", () => {
    expect(SessionInboundMessageSchema.parse(request())).not.toHaveProperty("activeRunBehavior");
  });
});
