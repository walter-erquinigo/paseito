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
  it("keeps the retained stack when a transient refresh returns no stack for the same branch", () => {
    const retained = stack("user/topic-a-change");

    expect(
      selectVisibleWorkspaceStack({
        queryStack: null,
        retainedStack: retained,
        currentBranch: "user/topic-a-change",
      }),
    ).toBe(retained);
  });

  it("hides a retained stack after the checkout moves to a different branch", () => {
    expect(
      selectVisibleWorkspaceStack({
        queryStack: null,
        retainedStack: stack("user/topic-a-change"),
        currentBranch: "main",
      }),
    ).toBeNull();
  });
});
