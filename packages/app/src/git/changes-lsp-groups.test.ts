import { describe, expect, it } from "vitest";
import { changesLspGroupSnapshot, groupChangesLspFiles } from "./changes-lsp-groups";
import type { ParsedDiffFile } from "./use-diff-query";
import type { EditorLspSnapshot } from "@/file-pane/editor/lsp-session";

function file(path: string, isDeleted = false): ParsedDiffFile {
  return { path, isNew: false, isDeleted, additions: 1, deletions: 1, hunks: [] };
}

describe("Changes toolbar LSP groups", () => {
  it("deduplicates kinds and paths across all current-side changes", () => {
    expect(
      groupChangesLspFiles([
        file("one.py"),
        file("main.cc"),
        file("two.pyi"),
        file("header.HPP"),
        file("main.cc"),
        file("deleted.py", true),
        file("README.md"),
      ]),
    ).toEqual([
      { language: "cpp", paths: ["main.cc", "header.HPP"] },
      { language: "python", paths: ["one.py", "two.pyi"] },
    ]);
  });

  it("offers no actions for an empty or deleted-only source list", () => {
    expect(groupChangesLspFiles([])).toEqual([]);
    expect(groupChangesLspFiles([file("removed.cpp", true), file("notes.txt")])).toEqual([]);
  });

  it("keeps active providers and failures visible despite dormant documents", () => {
    const connecting: EditorLspSnapshot = { status: "connecting", provider: null, error: null };
    const ready: EditorLspSnapshot = { status: "ready", provider: "clangd", error: null };
    const unavailable: EditorLspSnapshot = {
      status: "unavailable",
      provider: null,
      error: "Source revision changed",
    };
    expect(changesLspGroupSnapshot([connecting, ready])).toBe(ready);
    expect(changesLspGroupSnapshot([connecting, ready, unavailable])).toBe(unavailable);
    expect(changesLspGroupSnapshot([connecting])).toBe(connecting);
  });
});
