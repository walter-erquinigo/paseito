import { describe, expect, it } from "vitest";
import {
  activateChangesFile,
  buildChangesFileTreeRows,
  getChangesFileStatus,
  retainSelectedChangesFile,
} from "./changes-file-tree-navigation";
import type { ParsedDiffFile } from "@/git/use-diff-query";

function createFile(
  path: string,
  options: { additions?: number; deletions?: number; isNew?: boolean; isDeleted?: boolean } = {},
): ParsedDiffFile {
  return {
    path,
    isNew: options.isNew ?? false,
    isDeleted: options.isDeleted ?? false,
    additions: options.additions ?? 1,
    deletions: options.deletions ?? 0,
    hunks: [],
  };
}

describe("changes file tree navigation", () => {
  it("expands a collapsed target and advances repeated focus requests", () => {
    const first = activateChangesFile({
      expandedPaths: ["src/other.ts"],
      focusRequestId: 40,
      path: "src/target.ts",
    });
    const second = activateChangesFile({
      expandedPaths: first.expandedPaths,
      focusRequestId: first.focusRequestId,
      path: "src/target.ts",
    });

    expect(first).toEqual({
      expandedPaths: ["src/other.ts", "src/target.ts"],
      focusPath: "src/target.ts",
      focusRequestId: 41,
      selectedPath: "src/target.ts",
    });
    expect(second.focusRequestId).toBe(42);
    expect(second.expandedPaths).toEqual(first.expandedPaths);
  });

  it("removes selection only after the selected path disappears", () => {
    const files = [createFile("src/target.ts")];

    expect(retainSelectedChangesFile("src/target.ts", files)).toBe("src/target.ts");
    expect(retainSelectedChangesFile("src/target.ts", [createFile("src/other.ts")])).toBeNull();
    expect(retainSelectedChangesFile(null, files)).toBeNull();
  });

  it("builds compressed status-bearing rows and omits a collapsed folder's descendants", () => {
    const files = [
      createFile("src/app/added.ts", { additions: 12, isNew: true }),
      createFile("src/lib/deleted.ts", { deletions: 3, isDeleted: true }),
    ];
    const expandedRows = buildChangesFileTreeRows(files, new Set());
    const collapsedRows = buildChangesFileTreeRows(files, new Set(["src"]));

    expect(
      expandedRows.map((row) =>
        row.kind === "folder" ? `folder:${row.displayName}` : `file:${row.file.path}`,
      ),
    ).toEqual([
      "folder:src",
      "folder:app",
      "file:src/app/added.ts",
      "folder:lib",
      "file:src/lib/deleted.ts",
    ]);
    expect(collapsedRows).toMatchObject([
      { kind: "folder", dirPath: "src", additions: 13, deletions: 3 },
    ]);
    expect(getChangesFileStatus(files[0])).toBe("added");
    expect(getChangesFileStatus(files[1])).toBe("deleted");
    expect(getChangesFileStatus(createFile("src/modified.ts"))).toBe("modified");
  });
});
