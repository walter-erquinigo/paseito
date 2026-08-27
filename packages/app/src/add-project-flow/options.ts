import {
  isCompleteGitRemote,
  parseGitHubRemoteUrl,
  parseGitRemoteLocation,
} from "@getpaseo/protocol/git-remote";
import { shortenPath } from "@/utils/shorten-path";
import type { AddProjectHost, GithubRepositoryChoice, ProjectWorktreeSourceChoice } from "./model";

export type AddProjectMethodId =
  | "directory-search"
  | "browse"
  | "github"
  | "new-directory"
  | "worktree";

export interface AddProjectMethodOption {
  id: AddProjectMethodId;
  label: string;
  description: string;
  disabled?: boolean;
}

export interface AddProjectPathOption {
  id: string;
  path: string;
  displayPath: string;
  secondaryText: string | null;
  disabled: boolean;
}

export function filterAddProjectHosts(hosts: AddProjectHost[], query: string): AddProjectHost[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return hosts;
  return hosts.filter(
    (host) =>
      host.label.toLowerCase().includes(normalized) ||
      host.serverId.toLowerCase().includes(normalized),
  );
}

export function buildAddProjectMethods(host: AddProjectHost): AddProjectMethodOption[] {
  if (!host.canAddProject) return [];
  const options: AddProjectMethodOption[] = [];
  options.push({
    id: "directory-search",
    label: "Search for directory",
    description: `Find a directory on ${host.label}`,
  });
  if (host.canBrowse) {
    options.push({
      id: "browse",
      label: "Browse",
      description: "Choose or create a directory in Finder",
    });
  }
  options.push({
    id: "github",
    label: "Clone from GitHub",
    description: githubMethodDescription(host),
    disabled: !host.canCloneGithubRepositories,
  });
  options.push({
    id: "new-directory",
    label: "New directory",
    description: host.canCreateDirectory
      ? `Create an empty directory on ${host.label}`
      : "Update this host to create directories",
    disabled: !host.canCreateDirectory,
  });
  options.push({
    id: "worktree",
    label: "Create worktree",
    description: host.canManageProjectWorktrees
      ? "Create from a local project or remote Git URL"
      : "Update this host to create managed worktrees",
    disabled: !host.canManageProjectWorktrees,
  });
  return options;
}

export function addProjectMethodEmptyText(host: AddProjectHost | null): string {
  return host?.canAddProject === false
    ? "Update the host to use Add Project."
    : "No matching options";
}

function githubMethodDescription(host: AddProjectHost): string {
  if (!host.canCloneGithubRepositories) {
    return "Update this host to clone GitHub repositories";
  }
  if (host.canSearchGithubRepositories) {
    return "Search projects available to your GitHub account";
  }
  return "Enter a GitHub URL or owner/repo";
}

export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? trimmed;
}

export function buildManualGithubRepositoryChoices(query: string): GithubRepositoryChoice[] {
  const repo = query.trim();
  if (!repo) return [];

  if (isCompleteGitRemote(repo)) {
    const identity = parseGitHubRemoteUrl(repo);
    const location = parseGitRemoteLocation(repo);
    const remoteName = location ? pathBaseName(location.path).replace(/\.git$/u, "") : repo;
    return [
      {
        id: `manual:${repo}`,
        nameWithOwner: identity?.repo ?? remoteName,
        cloneUrl: repo,
        description: "Clone this repository URL",
        updatedAt: null,
      },
    ];
  }

  const shorthand = repo.match(/^([^\s/]+)\/([^\s/]+)$/u);
  if (!shorthand) return [];
  const nameWithOwner = `${shorthand[1]}/${shorthand[2]}`;
  return (["https", "ssh"] as const).map((cloneProtocol) => ({
    id: `manual:${cloneProtocol}:${nameWithOwner}`,
    nameWithOwner,
    cloneUrl: nameWithOwner,
    cloneProtocol,
    description: `Clone owner/repo via ${cloneProtocol.toUpperCase()}`,
    updatedAt: null,
  }));
}

export function parentDirectory(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return null;
  if (index === 0) return trimmed.slice(0, 1);
  return trimmed.slice(0, index);
}

export function joinDirectoryPath(parent: string, name: string): string {
  const trimmedParent = parent.replace(/[\\/]+$/, "");
  const separator = trimmedParent.includes("\\") && !trimmedParent.includes("/") ? "\\" : "/";
  return `${trimmedParent}${separator}${name}`;
}

export function buildSuggestedParentDirectories(projectPaths: string[]): string[] {
  const values = [
    ...projectPaths.flatMap((path) => {
      const parent = parentDirectory(path);
      return parent ? [parent] : [];
    }),
    "~/dev",
    "~/Developer",
    "~/src",
    "~/projects",
    "~/workspace",
    "~",
  ];
  return [...new Set(values)];
}

export function buildDefaultProjectWorktreePath(input: {
  source: ProjectWorktreeSourceChoice;
  projectPaths: string[];
}): string {
  if (input.source.kind === "local") {
    const parent = parentDirectory(input.source.path) ?? "~";
    const name = pathBaseName(input.source.path).replace(/\.git$/u, "") || "project";
    return joinDirectoryPath(parent, `${name}-worktree`);
  }
  const location = parseGitRemoteLocation(input.source.url);
  const name = (location ? pathBaseName(location.path) : "project").replace(/\.git$/u, "");
  const parent = buildSuggestedParentDirectories(input.projectPaths)[0] ?? "~/Developer";
  return joinDirectoryPath(parent, `${name || "project"}-worktree`);
}

export function buildRemoteWorktreeSourceChoice(
  query: string,
): Extract<ProjectWorktreeSourceChoice, { kind: "remote" }> | null {
  const url = query.trim();
  if (!isCompleteGitRemote(url)) return null;
  const location = parseGitRemoteLocation(url);
  return {
    kind: "remote",
    url,
    displayName: location ? pathBaseName(location.path).replace(/\.git$/u, "") : url,
  };
}

export function buildCloneLocationOptions(input: {
  parents: string[];
  repositoryName: string;
  existingPaths: string[];
}): AddProjectPathOption[] {
  const existing = new Set(input.existingPaths.map(pathIdentity));
  const seen = new Set<string>();
  return input.parents.flatMap((parent) => {
    const path = joinDirectoryPath(parent, input.repositoryName);
    const identity = pathIdentity(path);
    if (seen.has(identity)) return [];
    seen.add(identity);
    const pathExists = existing.has(identity);
    return [
      {
        id: parent,
        path: parent,
        displayPath: path,
        secondaryText: pathExists ? "Already exists" : `Parent directory: ${parent}`,
        disabled: pathExists,
      },
    ];
  });
}

function pathIdentity(path: string): string {
  const normalized = shortenPath(path.trim()).replace(/\\/g, "/").replace(/\/+$/u, "");
  return /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}
