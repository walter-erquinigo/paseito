import { describe, expect, it, vi } from "vitest";
import { openWorkspaceFileFromExplorer } from "./workspace-file-open-command";

describe("openWorkspaceFileFromExplorer", () => {
  it("preserves a requested source location when opening a compact explorer file", () => {
    const openWorkspaceTabInFocusedPane = vi.fn(() => "file-tab");
    const focusWorkspaceTab = vi.fn();

    openWorkspaceFileFromExplorer({
      filePath: "src/example.ts",
      location: { lineStart: 14, openMode: "source" },
      persistenceKey: "server:workspace",
      showMobileAgent: vi.fn(),
      openWorkspaceTabInFocusedPane,
      focusWorkspaceTab,
    });

    expect(openWorkspaceTabInFocusedPane).toHaveBeenCalledWith(
      "server:workspace",
      { kind: "file", path: "src/example.ts", lineStart: 14, openMode: "source" },
      expect.any(Object),
    );
    expect(focusWorkspaceTab).toHaveBeenCalledWith("server:workspace", "file-tab");
  });
});
