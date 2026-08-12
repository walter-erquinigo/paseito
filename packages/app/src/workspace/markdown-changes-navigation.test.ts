import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  canNavigateToCurrentLine,
  createWorkingDiffNavigationTarget,
  resolveMarkdownChangesNavigation,
  type WorkingDiffNavigationSnapshot,
} from "./markdown-changes-navigation";
import type { WorkspaceTab } from "@/workspace-tabs/model";

function diffFile(overrides: Partial<ParsedDiffFile> = {}): ParsedDiffFile {
  return {
    path: "src/example.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 1,
    status: "ok",
    oldLineCount: 30,
    newLineCount: 30,
    revision: "revision-1",
    hunks: [
      {
        oldStart: 9,
        oldCount: 3,
        newStart: 9,
        newCount: 3,
        lines: [
          { type: "header", content: "@@ -9,3 +9,3 @@" },
          { type: "context", content: " line 9" },
          { type: "remove", content: "-old line 10" },
          { type: "add", content: "+new line 10" },
          { type: "context", content: " line 11" },
        ],
      },
    ],
    ...overrides,
  };
}

const changesTab: WorkspaceTab = {
  tabId: "working_diff",
  target: { kind: "working_diff", focusRequestId: 4 },
  createdAt: 1,
};

function snapshot(files = [diffFile()]): WorkingDiffNavigationSnapshot {
  return {
    tabId: "working_diff",
    files,
    isLoading: false,
    contextExpansionSupported: true,
  };
}

describe("Markdown Changes navigation", () => {
  it("normalizes an absolute workspace target and routes a rendered current-side line", () => {
    const navigation = resolveMarkdownChangesNavigation({
      workspaceRoot: "/repo",
      location: { path: "/repo/src/../src/example.ts", lineStart: 10, lineEnd: 11, column: 7 },
      tabs: [changesTab],
      snapshot: snapshot(),
    });
    expect(navigation).toEqual({
      tabId: "working_diff",
      target: {
        kind: "working_diff",
        focusPath: "src/example.ts",
        focusRequestId: expect.any(Number),
        focusLineStart: 10,
        focusLineEnd: 11,
        focusColumn: 7,
      },
    });
  });

  it("routes an omitted current-side line only when context expansion is supported", () => {
    expect(canNavigateToCurrentLine(diffFile(), 20, true)).toBe(true);
    expect(canNavigateToCurrentLine(diffFile(), 20, false)).toBe(false);
  });

  it("falls back when the Changes tab or its current snapshot is absent", () => {
    const input = {
      workspaceRoot: "/repo",
      location: { path: "src/example.ts", lineStart: 10 },
    };
    expect(
      resolveMarkdownChangesNavigation({ ...input, tabs: [], snapshot: snapshot() }),
    ).toBeNull();
    expect(
      resolveMarkdownChangesNavigation({ ...input, tabs: [changesTab], snapshot: null }),
    ).toBeNull();
  });

  it("falls back for absent, loading, outside-workspace, and unavailable targets", () => {
    const resolve = (location: { path: string; lineStart: number }, nextSnapshot = snapshot()) =>
      resolveMarkdownChangesNavigation({
        workspaceRoot: "/repo",
        location,
        tabs: [changesTab],
        snapshot: nextSnapshot,
      });

    expect(resolve({ path: "src/absent.ts", lineStart: 10 })).toBeNull();
    expect(resolve({ path: "/outside/example.ts", lineStart: 10 })).toBeNull();
    expect(resolve({ path: "src/example.ts", lineStart: 31 })).toBeNull();
    expect(
      resolve({ path: "src/example.ts", lineStart: 10 }, { ...snapshot(), isLoading: true }),
    ).toBeNull();
    expect(
      resolve({ path: "src/example.ts", lineStart: 10 }, snapshot([diffFile({ isDeleted: true })])),
    ).toBeNull();
    expect(
      resolve(
        { path: "src/example.ts", lineStart: 10 },
        snapshot([diffFile({ status: "binary", hunks: [] })]),
      ),
    ).toBeNull();
  });

  it("increments legacy and repeated request IDs monotonically", () => {
    const first = createWorkingDiffNavigationTarget({
      current: { kind: "working_diff" },
      path: "src/example.ts",
      lineStart: 10,
    });
    const second = createWorkingDiffNavigationTarget({
      current: first,
      path: "src/example.ts",
      lineStart: 10,
    });
    expect(first.focusRequestId).toBeGreaterThan(0);
    expect(second.focusRequestId).toBeGreaterThan(first.focusRequestId ?? 0);
  });
});
