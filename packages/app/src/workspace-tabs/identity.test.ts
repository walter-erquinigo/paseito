import { describe, expect, it, test } from "vitest";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "./identity";

describe("New tab identity", () => {
  it("stays outside deterministic target identity", () => {
    const target = { kind: "new_tab" } as const;

    expect(normalizeWorkspaceTabTarget(target)).toEqual(target);
    expect(workspaceTabTargetsEqual(target, target)).toBe(false);
    expect(() => buildDeterministicWorkspaceTabId(target)).toThrow(
      "New tabs do not have deterministic target identities",
    );
  });
});

describe("provider subagent tab identity", () => {
  test("normalizes and compares the parent and provider child as one tab identity", () => {
    const target = normalizeWorkspaceTabTarget({
      kind: "provider_subagent",
      parentAgentId: " parent-a ",
      subagentId: " child-a ",
    });

    expect(target).toEqual({
      kind: "provider_subagent",
      parentAgentId: "parent-a",
      subagentId: "child-a",
    });
    expect(
      target &&
        workspaceTabTargetsEqual(target, {
          kind: "provider_subagent",
          parentAgentId: "parent-a",
          subagentId: "child-a",
        }),
    ).toBe(true);
  });

  test("does not collide when parent and child ids contain separators", () => {
    const first = buildDeterministicWorkspaceTabId({
      kind: "provider_subagent",
      parentAgentId: "a_b",
      subagentId: "c",
    });
    const second = buildDeterministicWorkspaceTabId({
      kind: "provider_subagent",
      parentAgentId: "a",
      subagentId: "b_c",
    });

    expect(first).not.toBe(second);
  });
});

describe("working diff tab identity", () => {
  const target = {
    kind: "working_diff" as const,
    focusPath: "src/example.ts",
    focusRequestId: 1,
  };

  it("normalizes file focus navigation", () => {
    expect(
      normalizeWorkspaceTabTarget({
        ...target,
        focusPath: " src\\example.ts ",
      }),
    ).toEqual(target);
  });

  it("normalizes optional line, range, and column navigation while preserving legacy targets", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "working_diff",
        focusPath: "src/example.ts",
        focusRequestId: 2.9,
        focusLineStart: 10.9,
        focusLineEnd: 14.8,
        focusColumn: 5.4,
        focusReveal: "center-if-hidden",
      }),
    ).toEqual({
      kind: "working_diff",
      focusPath: "src/example.ts",
      focusRequestId: 2,
      focusLineStart: 10,
      focusLineEnd: 14,
      focusColumn: 5,
      focusReveal: "center-if-hidden",
    });
    expect(normalizeWorkspaceTabTarget({ kind: "working_diff" })).toEqual({
      kind: "working_diff",
    });
  });

  it("treats focus as navigation state rather than tab identity", () => {
    expect(workspaceTabTargetsEqual(target, target)).toBe(true);
    expect(workspaceTabTargetsEqual(target, { ...target, focusPath: "src/other.ts" })).toBe(false);
    expect(workspaceTabTargetsEqual(target, { ...target, focusRequestId: 2 })).toBe(false);
    expect(workspaceTabTargetsEqual(target, { ...target, focusReveal: "center-if-hidden" })).toBe(
      false,
    );
    const workingDiffId = buildDeterministicWorkspaceTabId(target);
    const otherFocusId = buildDeterministicWorkspaceTabId({
      ...target,
      focusPath: "src/other.ts",
    });
    const fileId = buildDeterministicWorkspaceTabId({
      kind: "file",
      path: target.focusPath,
    });

    expect(workingDiffId).toBe("working_diff");
    expect(workingDiffId).toBe(otherFocusId);
    expect(workingDiffId).not.toBe(fileId);
  });
});

describe("workspace utility panel identity", () => {
  it.each(["files", "pull_request"] as const)(
    "normalizes and deterministically keys %s",
    (kind) => {
      const target = { kind };

      expect(normalizeWorkspaceTabTarget(target)).toEqual(target);
      expect(buildDeterministicWorkspaceTabId(target)).toBe(kind);
      expect(workspaceTabTargetsEqual(target, target)).toBe(true);
    },
  );
});

describe("commit diff tab identity", () => {
  it("keys a commit diff tab by its sha", () => {
    expect(buildDeterministicWorkspaceTabId({ kind: "commit_diff", sha: "abc123" })).toBe(
      "commit_diff_abc123",
    );
  });

  it("does not collide a commit diff tab id with a file tab id", () => {
    const diffId = buildDeterministicWorkspaceTabId({ kind: "commit_diff", sha: "abc123" });
    const fileId = buildDeterministicWorkspaceTabId({
      kind: "file",
      path: "abc123",
    });
    expect(diffId).not.toBe(fileId);
  });

  it("treats two commit diff targets with the same sha as equal", () => {
    expect(
      workspaceTabTargetsEqual(
        { kind: "commit_diff", sha: "abc123" },
        { kind: "commit_diff", sha: "abc123" },
      ),
    ).toBe(true);
  });

  it("treats commit diff targets with different shas as unequal", () => {
    expect(
      workspaceTabTargetsEqual(
        { kind: "commit_diff", sha: "abc123" },
        { kind: "commit_diff", sha: "def456" },
      ),
    ).toBe(false);
  });

  it("normalizes a commit diff target", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "commit_diff",
        sha: "abc123",
      }),
    ).toEqual({ kind: "commit_diff", sha: "abc123" });
  });

  it("rejects a commit diff target with a blank sha", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "commit_diff",
        sha: "   ",
      }),
    ).toBeNull();
  });
});

describe("plugin panel tab identity", () => {
  it("normalizes exact workspace and agent context", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "plugin",
        pluginId: " review ",
        panelId: " details ",
        context: "agent",
        agentId: " agent-1 ",
      }),
    ).toEqual({
      kind: "plugin",
      pluginId: "review",
      panelId: "details",
      context: "agent",
      agentId: "agent-1",
    });
  });

  it("gives workspace and agent instances distinct stable ids", () => {
    const workspace = buildDeterministicWorkspaceTabId({
      kind: "plugin",
      pluginId: "review",
      panelId: "details",
      context: "workspace",
    });
    const agent = buildDeterministicWorkspaceTabId({
      kind: "plugin",
      pluginId: "review",
      panelId: "details",
      context: "agent",
      agentId: "agent-1",
    });

    expect(workspace).toBe("plugin_workspace_6_review_7_details");
    expect(agent).toBe("plugin_agent_6_review_7_details_7_agent-1");
  });
});

describe("file tab location persistence", () => {
  it("preserves normalized columns while older saved tabs remain valid", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "file",
        path: " src\\app.ts ",
        lineStart: 10.9,
        column: 4.8,
        openMode: "source",
      }),
    ).toEqual({
      kind: "file",
      path: "src/app.ts",
      lineStart: 10,
      column: 4,
      openMode: "source",
    });
    expect(normalizeWorkspaceTabTarget({ kind: "file", path: "src/app.ts" })).toEqual({
      kind: "file",
      path: "src/app.ts",
    });
    expect(
      buildDeterministicWorkspaceTabId({
        kind: "file",
        path: "src/app.ts",
        lineStart: 10,
        column: 4,
      }),
    ).toBe("file_src/app.ts");
  });
});
