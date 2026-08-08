import { describe, expect, it } from "vitest";
import { collapseReviewedFile, expandInvalidatedFiles } from "./file-review-expansion";

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
});
