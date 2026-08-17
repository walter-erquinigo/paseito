export interface WorkspaceFileSearchEntry {
  path: string;
  name: string;
  directory: string;
}

export type UnsupportedFileSearchHost = "workspace" | "absolute" | null;

export function resolveUnsupportedFileSearchHost(input: {
  hostAvailable: boolean;
  supportsWorkspaceFileSearch: boolean;
  searchesAbsolutePath: boolean;
  supportsAbsolutePathSearch: boolean;
}): UnsupportedFileSearchHost {
  if (!input.hostAvailable) return null;
  if (!input.supportsWorkspaceFileSearch) return "workspace";
  if (input.searchesAbsolutePath && !input.supportsAbsolutePathSearch) return "absolute";
  return null;
}

export function describeWorkspaceFilePath(path: string): WorkspaceFileSearchEntry {
  const normalized = path.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return {
    path: normalized,
    name: separator >= 0 ? normalized.slice(separator + 1) : normalized,
    directory: separator >= 0 ? normalized.slice(0, separator) : "",
  };
}
