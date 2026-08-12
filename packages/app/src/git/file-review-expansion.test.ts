import { describe, expect, it } from "vitest";
import {
  collapseReviewedFile,
  expandOnlyUnreviewedFiles,
  expandInvalidatedFiles,
  expandUnreviewedFile,
  revealFileAncestorFolders,
} from "./file-review-expansion";

describe("file review expansion", () => {
  it("collapses only the file that was marked reviewed", () => {
    expect(collapseReviewedFile(new Set(["src/a.ts", "src/b.ts"]), "src/a.ts")).toEqual([
      "src/b.ts",
    ]);
  });

  it("reopens newly invalidated files without collapsing other files", () => {
    expect(expandInvalidatedFiles(new Set(["src/a.ts"]), ["src/b.ts", "src/c.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("expands a file when it is marked unreviewed", () => {
    expect(expandUnreviewedFile(new Set(["src/a.ts"]), "src/b.ts")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("expands every incomplete file and collapses every reviewed file", () => {
    expect(
      expandOnlyUnreviewedFiles(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        new Set(["src/a.ts", "src/c.ts"]),
      ),
    ).toEqual(["src/b.ts"]);
  });

  it("collapses every file when review is complete", () => {
    expect(
      expandOnlyUnreviewedFiles(["src/a.ts", "src/b.ts"], new Set(["src/a.ts", "src/b.ts"])),
    ).toEqual([]);
  });

  it("opens only the tree folders needed to reveal incomplete files", () => {
    expect(
      revealFileAncestorFolders(
        ["src", "src/complete", "src/incomplete", "tests"],
        ["src/incomplete/example.ts"],
      ),
    ).toEqual(["src/complete", "tests"]);
  });
});
