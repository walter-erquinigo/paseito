import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createManagedProjectWorktree,
  removeManagedProjectWorktree,
  sanitizeRemoteUrlForStorage,
  type CreateManagedProjectWorktreeDependencies,
} from "./project-worktree-service.js";
import {
  createPersistedProjectRecord,
  type PersistedProjectRecord,
  type ProjectRegistry,
} from "./workspace-registry.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("managed Add Project worktrees", () => {
  test("creates an exact sibling worktree and runs AGENTS.md through setup", async () => {
    const root = await tempDirectory();
    const source = join(root, "project");
    const target = join(root, "project-worktree");
    initRepository(source);
    await writeFile(join(source, "AGENTS.md"), "Run pnpm install for a new worktree.\n");
    commitAll(source, "add instructions");
    const setup = vi.fn(async () => undefined);
    const harness = createHarness(root, setup);

    const result = await createManagedProjectWorktree(
      { source: { kind: "local", path: source }, targetPath: target },
      harness.dependencies,
    );

    expect(createRealpathAwarePathMatcher(target)(result.worktreePath)).toBe(true);
    expect(createRealpathAwarePathMatcher(target)(result.project.rootPath)).toBe(true);
    expect(result.project.managedWorktree).toMatchObject({
      sourceKind: "local",
      ownedSourceRepo: false,
    });
    expect(
      createRealpathAwarePathMatcher(source)(result.project.managedWorktree?.sourceRepoPath ?? ""),
    ).toBe(true);
    expect(result.setup).toEqual({ status: "completed", error: null });
    expect(setup).toHaveBeenCalledOnce();
    expect(setup.mock.calls[0]?.[0].agentsInstructions).toBe(
      "Run pnpm install for a new worktree.\n",
    );
    expect(createRealpathAwarePathMatcher(target)(setup.mock.calls[0]?.[0].cwd ?? "")).toBe(true);
    expect(
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: target,
        encoding: "utf8",
      }).trim(),
    ).toBe("true");
  });

  test("clones a remote source into owned storage and removes both managed directories", async () => {
    const root = await tempDirectory();
    const remote = join(root, "remote");
    const target = join(root, "remote-worktree");
    initRepository(remote);
    const harness = createHarness(
      root,
      vi.fn(async () => undefined),
    );

    const result = await createManagedProjectWorktree(
      { source: { kind: "remote", url: remote }, targetPath: target },
      harness.dependencies,
    );
    const sourceRepoPath = result.project.managedWorktree?.sourceRepoPath;
    expect(sourceRepoPath).toContain(join(root, "paseo-home", "project-worktree-sources"));
    expect(result.setup.status).toBe("not_needed");
    expect(
      execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: sourceRepoPath,
        encoding: "utf8",
      }).trim(),
    ).toBe(remote);

    await removeManagedProjectWorktree({
      project: result.project,
      paseoHome: harness.dependencies.paseoHome,
    });

    await expect(readFile(join(target, ".git"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(sourceRepoPath!, ".git", "HEAD"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("redacts HTTP credentials and parameters without removing a usable origin", () => {
    expect(
      sanitizeRemoteUrlForStorage(
        "https://oauth2:secret@git.example.com/team/repo.git?access_token=secret#fragment",
      ),
    ).toBe("https://git.example.com/team/repo.git");
    expect(sanitizeRemoteUrlForStorage("git@example.com:team/repo.git")).toBe(
      "git@example.com:team/repo.git",
    );
  });

  test("keeps a local source and refuses deletion when the ownership token is changed", async () => {
    const root = await tempDirectory();
    const source = join(root, "source");
    const target = join(root, "source-worktree");
    initRepository(source);
    const harness = createHarness(
      root,
      vi.fn(async () => undefined),
    );
    const result = await createManagedProjectWorktree(
      { source: { kind: "local", path: source }, targetPath: target },
      harness.dependencies,
    );
    const managed = result.project.managedWorktree;
    expect(managed).not.toBeNull();

    await expect(
      removeManagedProjectWorktree({
        project: {
          ...result.project,
          managedWorktree: { ...managed!, ownershipToken: "tampered" },
        },
        paseoHome: harness.dependencies.paseoHome,
      }),
    ).rejects.toThrow("ownership marker does not match");
    expect(
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: target,
        encoding: "utf8",
      }).trim(),
    ).toBe("true");

    await removeManagedProjectWorktree({
      project: result.project,
      paseoHome: harness.dependencies.paseoHome,
    });
    expect(
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: source,
        encoding: "utf8",
      }).trim(),
    ).toBe("true");
  });
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "paseito-project-worktree-"));
  temporaryDirectories.push(path);
  return path;
}

function initRepository(path: string): void {
  execFileSync("git", ["init", "--initial-branch=main", path]);
  execFileSync("git", ["config", "user.email", "paseito@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Paseito Test"], { cwd: path });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: path });
}

function commitAll(path: string, message: string): void {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-m", message], { cwd: path });
}

function createHarness(
  root: string,
  runSetupAgent: CreateManagedProjectWorktreeDependencies["runSetupAgent"],
): {
  dependencies: CreateManagedProjectWorktreeDependencies;
} {
  const projects = new Map<string, PersistedProjectRecord>();
  const projectRegistry: ProjectRegistry = {
    initialize: async () => undefined,
    existsOnDisk: async () => true,
    list: async () => [...projects.values()],
    get: async (id) => projects.get(id) ?? null,
    getOrCreateActiveByRoot: async () => {
      throw new Error("unused");
    },
    upsert: async (record) => {
      projects.set(record.projectId, record);
    },
    update: async (id, updater) => {
      const current = projects.get(id);
      if (!current) return null;
      const next = updater(current);
      projects.set(id, next);
      return next;
    },
    archive: async () => undefined,
    remove: async (id) => {
      projects.delete(id);
    },
  };
  let projectNumber = 0;
  return {
    dependencies: {
      paseoHome: join(root, "paseo-home"),
      projectRegistry,
      registerProject: async (path) => {
        projectNumber += 1;
        const timestamp = new Date().toISOString();
        const project = createPersistedProjectRecord({
          projectId: `project-${projectNumber}`,
          rootPath: path,
          kind: "git",
          displayName: path.split("/").at(-1) ?? path,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        projects.set(project.projectId, project);
        return project;
      },
      resolveLocalRepoRoot: async (path) =>
        execFileSync("git", ["rev-parse", "--show-toplevel"], {
          cwd: path,
          encoding: "utf8",
        }).trim(),
      resolveDefaultBranch: async () => "main",
      runSetupAgent,
      logger: { warn: vi.fn() },
    },
  };
}
