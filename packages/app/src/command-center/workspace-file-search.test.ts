import { describe, expect, it } from "vitest";
import {
  describeWorkspaceFilePath,
  resolveUnsupportedFileSearchHost,
} from "./workspace-file-search-model";

describe("describeWorkspaceFilePath", () => {
  it("separates a workspace-relative file into its row labels", () => {
    expect(describeWorkspaceFilePath("src/components/message.tsx")).toEqual({
      path: "src/components/message.tsx",
      name: "message.tsx",
      directory: "src/components",
    });
  });

  it("normalizes Windows separators before opening or presenting a file", () => {
    expect(describeWorkspaceFilePath("src\\components\\message.tsx")).toEqual({
      path: "src/components/message.tsx",
      name: "message.tsx",
      directory: "src/components",
    });
  });

  it("keeps root files free of a redundant directory label", () => {
    expect(describeWorkspaceFilePath("package.json")).toEqual({
      path: "package.json",
      name: "package.json",
      directory: "",
    });
  });

  it("preserves an absolute host path for display and opening", () => {
    expect(describeWorkspaceFilePath("/raid/werquinigo/AGENTS.md")).toEqual({
      path: "/raid/werquinigo/AGENTS.md",
      name: "AGENTS.md",
      directory: "/raid/werquinigo",
    });
  });
});

describe("resolveUnsupportedFileSearchHost", () => {
  const currentHost = {
    hostAvailable: true,
    supportsWorkspaceFileSearch: true,
    supportsAbsolutePathSearch: true,
  };

  it("keeps ordinary and absolute search enabled on a current host", () => {
    expect(
      resolveUnsupportedFileSearchHost({ ...currentHost, searchesAbsolutePath: false }),
    ).toBeNull();
    expect(
      resolveUnsupportedFileSearchHost({ ...currentHost, searchesAbsolutePath: true }),
    ).toBeNull();
  });

  it("blocks only absolute paths when the host lacks absolute-path search", () => {
    const host = { ...currentHost, supportsAbsolutePathSearch: false };
    expect(resolveUnsupportedFileSearchHost({ ...host, searchesAbsolutePath: false })).toBeNull();
    expect(resolveUnsupportedFileSearchHost({ ...host, searchesAbsolutePath: true })).toBe(
      "absolute",
    );
  });

  it("blocks every file search when the host lacks workspace search", () => {
    expect(
      resolveUnsupportedFileSearchHost({
        ...currentHost,
        supportsWorkspaceFileSearch: false,
        searchesAbsolutePath: false,
      }),
    ).toBe("workspace");
  });
});
