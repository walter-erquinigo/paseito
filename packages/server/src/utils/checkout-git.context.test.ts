import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCheckoutDiff, getCheckoutDiffContext } from "./checkout-git.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function initRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "checkout-context-test-")));
  tempDirs.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
  const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  writeFileSync(join(repo, "sample.ts"), `${lines.join("\n")}\n`);
  execFileSync("git", ["add", "sample.ts"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });
  lines[49] = "const changed = 50;";
  writeFileSync(join(repo, "sample.ts"), `${lines.join("\n")}\n`);
  return repo;
}

describe("checkout diff context", () => {
  it("reports file bounds and returns bounded highlighted context", async () => {
    const cwd = initRepo();
    const diff = await getCheckoutDiff(cwd, { mode: "uncommitted", includeStructured: true });
    const file = diff.structured?.[0];

    expect(file).toMatchObject({ path: "sample.ts", oldLineCount: 100, newLineCount: 100 });
    expect(file?.revision).toMatch(/^[a-f0-9]{64}$/);

    const context = await getCheckoutDiffContext(cwd, {
      compare: { mode: "uncommitted" },
      filePath: "sample.ts",
      expectedRevision: file?.revision,
      region: { oldStart: 1, newStart: 1, lineCount: 40 },
      offset: 10,
      limit: 2,
    });
    expect(context.lines.map((line) => [line.newLineNumber, line.content])).toEqual([
      [11, "line 11"],
      [12, "line 12"],
    ]);
    expect(context.hasMore).toBe(true);
  });

  it("rejects stale revisions and paths outside the checkout", async () => {
    const cwd = initRepo();
    await expect(
      getCheckoutDiffContext(cwd, {
        compare: { mode: "uncommitted" },
        filePath: "sample.ts",
        expectedRevision: "stale",
        region: { oldStart: 1, newStart: 1, lineCount: 2 },
        offset: 0,
        limit: 2,
      }),
    ).rejects.toThrow("file changed");
    await expect(
      getCheckoutDiffContext(cwd, {
        compare: { mode: "uncommitted" },
        filePath: "../secret",
        region: { oldStart: 1, newStart: 1, lineCount: 1 },
        offset: 0,
        limit: 1,
      }),
    ).rejects.toThrow("stay within");
  });
});
