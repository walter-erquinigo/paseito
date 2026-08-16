import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SOURCE_REVISION_MISMATCH_ERROR, reconstructRevisionedSource } from "./revisioned-source";

function sha256(content: string): Promise<string> {
  return Promise.resolve(createHash("sha256").update(content).digest("hex"));
}

describe("revisioned Changes source reconstruction", () => {
  it("restores a final newline when it belongs to the revision", async () => {
    const content = "int main() {\n  return 0;\n}\n";

    await expect(
      reconstructRevisionedSource({
        lines: ["int main() {", "  return 0;", "}"],
        revision: await sha256(content),
        digest: sha256,
      }),
    ).resolves.toBe(content);
  });

  it.each([
    ["no final newline", ["first", "second"], "first\nsecond"],
    ["CRLF", ["first\r", "second\r"], "first\r\nsecond\r\n"],
    ["multiple final blank lines", ["first", "", ""], "first\n\n\n"],
  ])("preserves %s content", async (_name, lines, content) => {
    await expect(
      reconstructRevisionedSource({
        lines,
        revision: await sha256(content),
        digest: sha256,
      }),
    ).resolves.toBe(content);
  });

  it("fails closed when neither newline form matches the revision", async () => {
    await expect(
      reconstructRevisionedSource({
        lines: ["different"],
        revision: await sha256("expected\n"),
        digest: sha256,
      }),
    ).rejects.toThrow(SOURCE_REVISION_MISMATCH_ERROR);
  });
});
