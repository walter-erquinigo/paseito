import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type { Logger } from "pino";
import { z } from "zod";
import type { ProjectWorktreeSource } from "@getpaseo/protocol/messages";

import { writeJsonFileAtomic } from "./atomic-file.js";
import type {
  ManagedProjectWorktree,
  PersistedProjectRecord,
  ProjectRegistry,
} from "./workspace-registry.js";
import { areEquivalentPaths, expandTilde, isRealpathInsideRoot } from "../utils/path.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { createWorktree, slugify } from "../utils/worktree.js";

const SOURCE_REPOSITORIES_DIRECTORY = "project-worktree-sources";
const OWNER_MARKER_RELATIVE_PATH = join("paseo", "project-worktree-owner.json");
const MAX_AGENTS_FILE_BYTES = 256 * 1024;

const ManagedProjectWorktreeMarkerSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  worktreePath: z.string().min(1),
  sourceRepoPath: z.string().min(1),
  ownershipToken: z.string().min(1),
});

type ManagedProjectWorktreeMarker = z.infer<typeof ManagedProjectWorktreeMarkerSchema>;

export interface ProjectWorktreeSetupResult {
  status: "not_needed" | "completed" | "failed";
  error: string | null;
}

export interface CreateManagedProjectWorktreeResult {
  project: PersistedProjectRecord;
  worktreePath: string;
  setup: ProjectWorktreeSetupResult;
}

export interface CreateManagedProjectWorktreeDependencies {
  paseoHome: string;
  projectRegistry: ProjectRegistry;
  registerProject(path: string): Promise<PersistedProjectRecord>;
  resolveLocalRepoRoot(path: string): Promise<string>;
  resolveDefaultBranch(repoRoot: string): Promise<string>;
  runSetupAgent(input: { cwd: string; agentsInstructions: string }): Promise<void>;
  logger: Pick<Logger, "warn">;
}

export async function createManagedProjectWorktree(
  input: { source: ProjectWorktreeSource; targetPath: string },
  dependencies: CreateManagedProjectWorktreeDependencies,
): Promise<CreateManagedProjectWorktreeResult> {
  const targetPath = resolveTargetPath(input.targetPath);
  await requireMissingPath(targetPath);

  const source = await resolveSourceRepository(input.source, dependencies);
  let worktreeCreated = false;
  let project: PersistedProjectRecord | null = null;
  try {
    const agentsInstructions = await readSourceAgentsInstructions(source.repoRoot);
    const defaultBranch =
      source.defaultBranch ?? (await dependencies.resolveDefaultBranch(source.repoRoot));
    const requestedBranch = slugify(basename(targetPath));
    if (!requestedBranch) {
      throw new Error("The worktree destination must end in a valid Git branch name");
    }

    const worktree = await createWorktree({
      cwd: source.repoRoot,
      worktreeSlug: requestedBranch,
      exactWorktreePath: targetPath,
      source: {
        kind: "branch-off",
        baseBranch: defaultBranch,
        branchName: requestedBranch,
      },
      runSetup: false,
      paseoHome: dependencies.paseoHome,
    });
    worktreeCreated = true;

    project = await dependencies.registerProject(worktree.worktreePath);
    const managedWorktree: ManagedProjectWorktree = {
      version: 1,
      worktreePath: worktree.worktreePath,
      sourceKind: input.source.kind,
      sourceRepoPath: source.repoRoot,
      ownedSourceRepo: source.owned,
      ownershipToken: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await writeOwnershipMarker(project.projectId, managedWorktree);
    const updatedProject = await dependencies.projectRegistry.update(
      project.projectId,
      (record) => ({
        ...record,
        managedWorktree,
        updatedAt: managedWorktree.createdAt,
      }),
    );
    if (!updatedProject) {
      throw new Error("Project disappeared while recording worktree ownership");
    }
    project = updatedProject;

    const setup = await runAgentsSetupIfNeeded({
      worktreePath: worktree.worktreePath,
      agentsInstructions,
      runSetupAgent: dependencies.runSetupAgent,
      logger: dependencies.logger,
    });
    return { project: updatedProject, worktreePath: worktree.worktreePath, setup };
  } catch (error) {
    if (project) {
      await dependencies.projectRegistry.remove(project.projectId).catch(() => undefined);
    }
    if (worktreeCreated) {
      await runGitCommand(["worktree", "remove", "--force", targetPath], {
        cwd: source.repoRoot,
        timeout: 120_000,
      }).catch(() => rm(targetPath, { recursive: true, force: true }));
    }
    if (source.owned) {
      await rm(source.repoRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function removeManagedProjectWorktree(input: {
  project: PersistedProjectRecord;
  paseoHome: string;
}): Promise<void> {
  await validateManagedProjectWorktreeRemoval(input);
  const managed = input.project.managedWorktree!;

  await runGitCommand(["worktree", "remove", "--force", managed.worktreePath], {
    cwd: managed.sourceRepoPath,
    timeout: 120_000,
  });
  if (managed.ownedSourceRepo) {
    await rm(managed.sourceRepoPath, { recursive: true, force: true });
  }
}

export async function validateManagedProjectWorktreeRemoval(input: {
  project: PersistedProjectRecord;
  paseoHome: string;
}): Promise<void> {
  const managed = input.project.managedWorktree;
  if (!managed) {
    throw new Error("Project is not a Paseito-managed worktree");
  }
  if (!areEquivalentPaths(input.project.rootPath, managed.worktreePath)) {
    throw new Error("Managed worktree path no longer matches the project root");
  }

  const marker = await readOwnershipMarker(managed.worktreePath);
  requireMatchingOwnershipMarker(marker, input.project.projectId, managed);
  if (managed.ownedSourceRepo) {
    const ownedRoot = resolve(input.paseoHome, SOURCE_REPOSITORIES_DIRECTORY);
    if (
      areEquivalentPaths(ownedRoot, managed.sourceRepoPath) ||
      !isRealpathInsideRoot(ownedRoot, managed.sourceRepoPath)
    ) {
      throw new Error("Managed source repository is outside Paseito storage");
    }
  }
}

async function resolveSourceRepository(
  source: ProjectWorktreeSource,
  dependencies: CreateManagedProjectWorktreeDependencies,
): Promise<{ repoRoot: string; owned: boolean; defaultBranch: string | null }> {
  if (source.kind === "local") {
    const sourcePath = resolve(expandTilde(source.path.trim()));
    return {
      repoRoot: await dependencies.resolveLocalRepoRoot(sourcePath),
      owned: false,
      defaultBranch: null,
    };
  }

  const url = source.url.trim();
  if (!url) {
    throw new Error("Remote Git URL is required");
  }
  const sourcesRoot = resolve(dependencies.paseoHome, SOURCE_REPOSITORIES_DIRECTORY);
  await mkdir(sourcesRoot, { recursive: true });
  const repoRoot = join(sourcesRoot, randomUUID());
  try {
    await runGitCommand(["clone", "--", url, repoRoot], {
      cwd: sourcesRoot,
      timeout: 5 * 60_000,
      maxOutputBytes: 1024 * 1024,
    });
    const defaultBranch = await dependencies.resolveDefaultBranch(repoRoot);
    // A clone persists its origin URL in .git/config. Preserve a usable remote,
    // but strip credentials and URL parameters before setup code can inspect it.
    await runGitCommand(["remote", "set-url", "origin", sanitizeRemoteUrlForStorage(url)], {
      cwd: repoRoot,
    });
    return { repoRoot, owned: true, defaultBranch };
  } catch (error) {
    await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function sanitizeRemoteUrlForStorage(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    if (url.password) {
      url.password = "";
      return url.toString();
    }
  } catch {
    // Local paths and SCP-style SSH remotes have no URL password component.
  }
  return rawUrl;
}

function resolveTargetPath(requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Worktree destination is required");
  }
  const expanded = expandTilde(trimmed);
  const targetPath = resolve(expanded);
  const parsedRoot = resolve(targetPath, "..");
  if (areEquivalentPaths(targetPath, parsedRoot)) {
    throw new Error("Worktree destination cannot be a filesystem root");
  }
  return targetPath;
}

async function requireMissingPath(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Worktree destination already exists: ${path}`);
}

async function readSourceAgentsInstructions(repoRoot: string): Promise<string | null> {
  try {
    const text = await readFile(join(repoRoot, "AGENTS.md"), "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_AGENTS_FILE_BYTES) {
      throw new Error(`AGENTS.md is larger than ${MAX_AGENTS_FILE_BYTES} bytes`);
    }
    return text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function runAgentsSetupIfNeeded(input: {
  worktreePath: string;
  agentsInstructions: string | null;
  runSetupAgent(params: { cwd: string; agentsInstructions: string }): Promise<void>;
  logger: Pick<Logger, "warn">;
}): Promise<ProjectWorktreeSetupResult> {
  if (input.agentsInstructions === null) {
    return { status: "not_needed", error: null };
  }
  try {
    await input.runSetupAgent({
      cwd: input.worktreePath,
      agentsInstructions: input.agentsInstructions,
    });
    return { status: "completed", error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pi setup session failed";
    input.logger.warn({ err: error, worktreePath: input.worktreePath }, "Pi worktree setup failed");
    return { status: "failed", error: message };
  }
}

async function ownershipMarkerPath(worktreePath: string): Promise<string> {
  const result = await runGitCommand(["rev-parse", "--git-dir"], { cwd: worktreePath });
  const rawGitDir = result.stdout.trim();
  if (!rawGitDir) {
    throw new Error("Unable to locate worktree Git metadata");
  }
  const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(worktreePath, rawGitDir);
  return join(gitDir, OWNER_MARKER_RELATIVE_PATH);
}

async function writeOwnershipMarker(
  projectId: string,
  managed: ManagedProjectWorktree,
): Promise<void> {
  const marker: ManagedProjectWorktreeMarker = {
    version: 1,
    projectId,
    worktreePath: managed.worktreePath,
    sourceRepoPath: managed.sourceRepoPath,
    ownershipToken: managed.ownershipToken,
  };
  const markerPath = await ownershipMarkerPath(managed.worktreePath);
  await mkdir(dirname(markerPath), { recursive: true });
  await writeJsonFileAtomic(markerPath, marker);
}

async function readOwnershipMarker(worktreePath: string): Promise<ManagedProjectWorktreeMarker> {
  const markerPath = await ownershipMarkerPath(worktreePath);
  try {
    return ManagedProjectWorktreeMarkerSchema.parse(JSON.parse(await readFile(markerPath, "utf8")));
  } catch (error) {
    throw new Error("Managed worktree ownership marker is missing or invalid", { cause: error });
  }
}

function requireMatchingOwnershipMarker(
  marker: ManagedProjectWorktreeMarker,
  projectId: string,
  managed: ManagedProjectWorktree,
): void {
  if (
    marker.projectId !== projectId ||
    marker.ownershipToken !== managed.ownershipToken ||
    !areEquivalentPaths(marker.worktreePath, managed.worktreePath) ||
    !areEquivalentPaths(marker.sourceRepoPath, managed.sourceRepoPath)
  ) {
    throw new Error("Managed worktree ownership marker does not match the project record");
  }
}
