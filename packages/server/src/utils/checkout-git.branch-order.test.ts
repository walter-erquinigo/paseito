import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listBranchSuggestions } from "./checkout-git.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd });
}

function commit(cwd: string, value: string): void {
  writeFileSync(join(cwd, "file.txt"), `${value}\n`);
  git(cwd, ["add", "file.txt"]);
  git(cwd, ["commit", "-m", value]);
}

describe("branch suggestion ordering", () => {
  it("orders the current stack before preferred-owner and other branches", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "branch-order-test-")));
    tempDirs.push(root);
    const cwd = join(root, "repo");
    mkdirSync(cwd);
    git(cwd, ["init", "-b", "main"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test User"]);
    commit(cwd, "base");

    git(cwd, ["checkout", "-b", "werquinigo/stack-1"]);
    commit(cwd, "stack 1");
    git(cwd, ["checkout", "-b", "werquinigo/stack-2"]);
    commit(cwd, "stack 2");
    git(cwd, ["checkout", "-b", "werquinigo/stack-3"]);
    commit(cwd, "stack 3");

    git(cwd, ["branch", "werquinigo/unrelated", "main"]);
    git(cwd, ["branch", "alice/other", "main"]);

    const suggestions = await listBranchSuggestions(cwd, { limit: 20 });
    expect(suggestions.slice(0, 3).map((branch) => branch.name)).toEqual([
      "werquinigo/stack-1",
      "werquinigo/stack-2",
      "werquinigo/stack-3",
    ]);
    expect(suggestions.findIndex((branch) => branch.name === "werquinigo/unrelated")).toBeLessThan(
      suggestions.findIndex((branch) => branch.name === "alice/other"),
    );
  });
});
