import { describe, expect, it } from "vitest";
import { searchChangesFiles } from "./changes-search";

describe("Changes search", () => {
  const files = [
    { path: "src/TypeConverter.h", lines: ["TypeConverter value;", "typeconverter other;"] },
    { path: "src/deleted.cc", lines: null },
  ];

  it("searches file names and complete source lines with smart case", () => {
    expect(searchChangesFiles(files, "typeconverter").matches).toHaveLength(3);
    expect(searchChangesFiles(files, "TypeConverter").matches).toEqual([
      { kind: "file", filePath: "src/TypeConverter.h", columnStart: 5 },
      {
        kind: "text",
        filePath: "src/TypeConverter.h",
        lineNumber: 1,
        columnStart: 1,
        preview: "TypeConverter value;",
      },
    ]);
  });

  it("keeps files without readable current-side content searchable by name", () => {
    expect(searchChangesFiles(files, "deleted").matches).toEqual([
      { kind: "file", filePath: "src/deleted.cc", columnStart: 5 },
    ]);
  });
});
