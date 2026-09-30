import { describe, expect, it } from "vitest";
import type { WorkspaceStack } from "@getpaseo/protocol/workspace-stack";
import { selectVisibleWorkspaceStack } from "./stack-menu-state";

function stack(currentBranch: string): WorkspaceStack {
  return {
    prefix: "topic",
    currentBranch,
    branches: [
      {
        name: currentBranch,
        sha: "abc123",
        index: "a",
        parent: "main",
        subject: "Subject",
      },
    ],
  };
}

describe("Stack menu display state", () => {
  it("keeps the retained stack when a transient refresh returns no stack", () => {
    const retained = stack("user/topic-a-change");

    expect(
      selectVisibleWorkspaceStack({
        queryStack: null,
        retainedStack: retained,
      }),
    ).toBe(retained);
  });

  it("uses the latest stack response when it is available", () => {
    const latest = stack("user/topic-b-change");

    expect(
      selectVisibleWorkspaceStack({
        queryStack: latest,
        retainedStack: stack("user/topic-a-change"),
      }),
    ).toBe(latest);
  });
});
