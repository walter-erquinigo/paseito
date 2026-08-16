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
  it("orders preferred-owner branches literally by name before other branches", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "branch-order-test-")));
    tempDirs.push(root);
    const cwd = join(root, "repo");
    mkdirSync(cwd);
    git(cwd, ["init", "-b", "main"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test User"]);
    commit(cwd, "base");

    git(cwd, ["checkout", "-b", "werquinigo/z-stack"]);
    commit(cwd, "z stack");
    git(cwd, ["checkout", "-b", "werquinigo/a-stack"]);
    commit(cwd, "a stack");

    git(cwd, ["branch", "werquinigo/middle", "main"]);
    git(cwd, ["branch", "werquinigo/task-2", "main"]);
    git(cwd, ["branch", "werquinigo/task-10", "main"]);
    git(cwd, ["branch", "alice/other", "main"]);

    const suggestions = await listBranchSuggestions(cwd, { limit: 20 });
    expect(suggestions.slice(0, 5).map((branch) => branch.name)).toEqual([
      "werquinigo/a-stack",
      "werquinigo/middle",
      "werquinigo/task-10",
      "werquinigo/task-2",
      "werquinigo/z-stack",
    ]);
    expect(suggestions[5]?.name).toBe("alice/other");
  });
});
