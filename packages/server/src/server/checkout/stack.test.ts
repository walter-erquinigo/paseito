import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { getWorkspaceStack } from "./stack.js";

const repositories: string[] = [];
function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "workspace-stack-"));
  repositories.push(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Stack Test");
  git("config", "user.email", "stack@example.com");
  git("commit", "--allow-empty", "-m", "Base");
  function branch(prefix: string, index: string, parent: string) {
    const name = `developer/${prefix}-${index}-change`;
    git("checkout", "-b", name, parent);
    git(
      "commit",
      "--allow-empty",
      "-m",
      `Change ${index}\n\nStack-Prefix: ${prefix}\nStack-Index: ${index}\nStack-Parent: ${parent}\nStack-Issue: TASK-1`,
    );
    return name;
  }
  return { cwd, git, branch };
}

afterEach(() => {
  for (const cwd of repositories.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

test("returns the whole local stack from a middle branch, excluding stacks sharing its base", async () => {
  const { cwd, git, branch } = repository();
  const a = branch("feature", "a", "main");
  const b = branch("feature", "b", a);
  const c = branch("feature", "c", b);
  branch("other", "a", "main");
  git("checkout", b);
  const stack = await getWorkspaceStack(cwd);
  expect(stack?.prefix).toBe("feature");
  expect(stack?.currentBranch).toBe(b);
  expect(stack?.branches.map(({ name, index, parent }) => ({ name, index, parent }))).toEqual([
    { name: a, index: "a", parent: "main" },
    { name: b, index: "b", parent: a },
    { name: c, index: "c", parent: b },
  ]);
});

test("ordinary and detached branches have no stack", async () => {
  const { cwd, git } = repository();
  expect(await getWorkspaceStack(cwd)).toBeNull();
  git("checkout", "--detach");
  expect(await getWorkspaceStack(cwd)).toBeNull();
});

test("uses Stack's lexical indices and works from a linked worktree", async () => {
  const { cwd, git, branch } = repository();
  const a = branch("feature", "a", "main");
  const aa = branch("feature", "aa", a);
  const b = branch("feature", "b", aa);
  const worktree = `${cwd}-worktree`;
  repositories.push(worktree);
  git("worktree", "add", worktree, aa);
  expect((await getWorkspaceStack(worktree))?.branches.map((item) => item.name)).toEqual([
    a,
    aa,
    b,
  ]);
});

test("rejects inconsistent issue metadata instead of combining stacks", async () => {
  const { cwd, git, branch } = repository();
  const a = branch("feature", "a", "main");
  branch("feature", "b", a);
  const message = git("log", "-1", "--format=%B").replace("TASK-1", "TASK-2");
  git("commit", "--amend", "--allow-empty", "-m", message);
  await expect(getWorkspaceStack(cwd)).rejects.toThrow("disagree on their identity");
});

test("rejects duplicate markers and a broken parent chain", async () => {
  const { cwd, git, branch } = repository();
  branch("feature", "a", "main");
  branch("feature", "b", "main");
  await expect(getWorkspaceStack(cwd)).rejects.toThrow("parent chain is broken");
  const message = git("log", "-1", "--format=%B");
  git("commit", "--amend", "--allow-empty", "-m", `${message}\nStack-Index: c`);
  await expect(getWorkspaceStack(cwd)).rejects.toThrow("Malformed or duplicate");
});
