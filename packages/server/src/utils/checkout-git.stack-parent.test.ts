import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCheckoutStatus } from "./checkout-git.js";

describe("checkout Stack-Parent status", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "checkout-stack-parent-test-")));
    repoDir = join(tempDir, "repo");
    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "file.txt"), "initial\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    commit("initial");
    execFileSync("git", ["branch", "werquinigo/parent"], { cwd: repoDir });
    execFileSync("git", ["checkout", "-b", "werquinigo/child"], { cwd: repoDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function commit(...messageArgs: string[]) {
    execFileSync(
      "git",
      [
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        ...messageArgs.flatMap((message) => ["-m", message]),
      ],
      { cwd: repoDir },
    );
  }

  async function stackParent() {
    const status = await getCheckoutStatus(repoDir);
    expect(status.isGit).toBe(true);
    if (!status.isGit) {
      throw new Error("expected git status");
    }
    return status.stackParent;
  }

  it("resolves a local Stack-Parent from the complete top-commit message", async () => {
    commit("child", "Context\n\nStack-Parent: werquinigo/parent");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    }).trim();

    await expect(stackParent()).resolves.toEqual({
      commitSha: sha,
      state: "valid",
      ref: "refs/heads/werquinigo/parent",
    });
  });

  it("resolves a remote-only Stack-Parent", async () => {
    execFileSync("git", ["update-ref", "refs/remotes/origin/werquinigo/remote-parent", "HEAD"], {
      cwd: repoDir,
    });
    commit("Stack-Parent: werquinigo/remote-parent");

    await expect(stackParent()).resolves.toMatchObject({
      state: "valid",
      ref: "origin/werquinigo/remote-parent",
    });
  });

  it.each([
    ["empty", ["Stack-Parent:"], "empty"],
    ["duplicate", ["Stack-Parent: main", "Stack-Parent: werquinigo/parent"], "multiple"],
    ["unsafe", ["Stack-Parent: bad..branch"], "invalid"],
    ["self", ["Stack-Parent: werquinigo/child"], "self"],
  ])("reports a malformed %s marker", async (_name, messages, reason) => {
    commit(...messages);

    await expect(stackParent()).resolves.toMatchObject({ state: "malformed", reason });
  });

  it("reports a missing Stack-Parent branch", async () => {
    commit("Stack-Parent: werquinigo/missing");

    await expect(stackParent()).resolves.toMatchObject({
      state: "missing",
      declaredRef: "werquinigo/missing",
    });
  });

  it("ignores differently cased and indented lines", async () => {
    commit("child", "stack-parent: main\n Stack-Parent: werquinigo/parent");

    await expect(stackParent()).resolves.toBeNull();
  });
});
