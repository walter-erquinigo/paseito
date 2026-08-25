import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import type { ChangesDiscussionThread } from "@/git/changes-discussions";
import {
  INLINE_COLLAPSED_FORGE_DISCUSSION_HEIGHT,
  INLINE_FORGE_DISCUSSION_HEIGHT,
  INLINE_RESOLVED_FORGE_DISCUSSION_HEIGHT,
  type InlineReviewActions,
} from "@/review/inline-review";
import { createDiffDocumentWorkspaceCache } from "./workspace-cache";
import type { BuildDiffDocumentModelInput, DiffPalette, TextMeasurer } from "./types";

const palette: DiffPalette = {
  surface: "#000",
  headerSurface: "#111",
  border: "#222",
  foreground: "#fff",
  foregroundMuted: "#aaa",
  addition: "green",
  deletion: "red",
  additionBackground: "#010",
  deletionBackground: "#100",
  emptyBackground: "#111",
  selection: "blue",
  syntax: { keyword: "purple" },
};

function diffFile(): ParsedDiffFile {
  return {
    path: "src/a.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        oldStart: 1,
        oldCount: 0,
        newStart: 1,
        newCount: 1,
        lines: [{ type: "add", content: "const answer = 42;" }],
      },
    ],
  };
}

function countingMeasurer() {
  const stats = { calls: 0 };
  const measureText: TextMeasurer = {
    measure(text) {
      stats.calls += 1;
      return text.length * 8;
    },
  };
  return { measureText, stats };
}

function reviewActions(overrides: Partial<InlineReviewActions> = {}): InlineReviewActions {
  return {
    canSuggest: false,
    composerMode: null,
    commentsByTarget: new Map(),
    editor: null,
    suggestionsByTarget: new Map(),
    suggestionEditor: null,
    selectedRangeTargetKeys: new Set(),
    suggestionRangeError: null,
    onStartComment: () => undefined,
    onEditComment: () => undefined,
    onCancelEditor: () => undefined,
    onSaveEditor: () => undefined,
    onDeleteComment: () => undefined,
    onStartSuggestion: () => undefined,
    onSwitchSuggestionToComment: () => undefined,
    onBeginSuggestionDrag: () => undefined,
    onUpdateSuggestionDrag: () => undefined,
    onShiftSuggestionRange: () => undefined,
    onPressReviewGutter: () => undefined,
    onCancelSuggestionRange: () => undefined,
    onClearSuggestionRangeError: () => undefined,
    onCancelSuggestion: () => undefined,
    onEditSuggestion: () => undefined,
    onExtendSuggestion: () => undefined,
    onSaveSuggestion: () => undefined,
    onDeleteSuggestion: () => undefined,
    ...overrides,
  };
}

function forgeThread(overrides: Partial<ChangesDiscussionThread> = {}): ChangesDiscussionThread {
  return {
    id: "discussion-1",
    comments: [
      {
        id: "note-1",
        kind: "comment",
        author: "Greptile",
        authorUrl: null,
        avatarUrl: null,
        body: "Review feedback",
        createdAt: 1,
        url: "https://gitlab.example/note/1",
      },
    ],
    placement: "exact",
    targetKey: "src/a.ts:new:1",
    targetPath: "src/a.ts",
    ...overrides,
  };
}

function modelInput(
  files: readonly ParsedDiffFile[],
  measureText: TextMeasurer,
  overrides: Partial<BuildDiffDocumentModelInput> = {},
): BuildDiffDocumentModelInput {
  return {
    files,
    collapsedFilePaths: new Set(),
    layout: "unified",
    wrapLines: false,
    viewportWidth: 800,
    typography: { family: "monospace", size: 12, lineHeight: 18 },
    measureText,
    palette,
    labels: { binary: "Binary", tooLarge: "Too large" },
    ...overrides,
  };
}

describe("diff document workspace cache", () => {
  it("reuses measured rows until a model-building input changes", () => {
    const cache = createDiffDocumentWorkspaceCache();
    const files = [diffFile()];
    const { measureText, stats } = countingMeasurer();
    const input = modelInput(files, measureText);

    const first = cache.buildModel(input);
    expect(stats.calls).toBeGreaterThan(0);

    stats.calls = 0;
    const second = cache.buildModel(input);
    expect(stats.calls).toBe(0);
    expect(second).toBe(first);

    const collapsed = cache.buildModel({
      ...input,
      collapsedFilePaths: new Set(["src/a.ts"]),
    });
    expect(collapsed).not.toBe(first);
    expect(collapsed.files[0]?.isCollapsed).toBe(true);

    cache.buildModel({ ...input, viewportWidth: 640 });
    expect(stats.calls).toBeGreaterThan(0);

    stats.calls = 0;
    cache.buildModel({
      ...input,
      typography: { family: "monospace", size: 13, lineHeight: 20 },
    });
    expect(stats.calls).toBeGreaterThan(0);

    stats.calls = 0;
    cache.buildModel({ ...input, palette: { ...palette, foreground: "#eee" } });
    expect(stats.calls).toBeGreaterThan(0);

    stats.calls = 0;
    cache.buildModel({ ...input, files: [...files] });
    expect(stats.calls).toBeGreaterThan(0);
  });

  it("bounds retained geometry variants for one diff payload", () => {
    const cache = createDiffDocumentWorkspaceCache();
    const files = [diffFile()];
    const { measureText, stats } = countingMeasurer();

    for (const viewportWidth of [600, 700, 800, 900, 1000]) {
      cache.buildModel(modelInput(files, measureText, { viewportWidth }));
    }

    stats.calls = 0;
    cache.buildModel(modelInput(files, measureText, { viewportWidth: 600 }));
    expect(stats.calls).toBeGreaterThan(0);
  });

  it("invalidates status rows when their translated labels change", () => {
    const cache = createDiffDocumentWorkspaceCache();
    const { measureText } = countingMeasurer();
    const files: ParsedDiffFile[] = [{ ...diffFile(), status: "binary", hunks: [] }];
    const first = cache.buildModel(modelInput(files, measureText));
    const second = cache.buildModel(
      modelInput(files, measureText, {
        labels: { binary: "Binary blob", tooLarge: "Too large" },
      }),
    );

    expect(first.rows[0]).toMatchObject({ kind: "status", label: "Binary" });
    expect(second.rows[0]).toMatchObject({ kind: "status", label: "Binary blob" });
  });

  it("invalidates cached row geometry when forge threads load or collapse", () => {
    const cache = createDiffDocumentWorkspaceCache();
    const { measureText } = countingMeasurer();
    const files = [diffFile()];
    const input = modelInput(files, measureText, { reviewActions: reviewActions() });
    const thread = forgeThread();

    const withoutThread = cache.buildModel(input);
    const expanded = cache.buildModel({
      ...input,
      reviewActions: reviewActions({
        forgeThreadsByTarget: new Map([["src/a.ts:new:1", [thread]]]),
      }),
    });
    const collapsed = cache.buildModel({
      ...input,
      reviewActions: reviewActions({
        forgeThreadsByTarget: new Map([["src/a.ts:new:1", [thread]]]),
        collapsedForgeThreadIds: new Set([thread.id]),
      }),
    });
    const resolved = cache.buildModel({
      ...input,
      reviewActions: reviewActions({
        forgeThreadsByTarget: new Map([["src/a.ts:new:1", [{ ...thread, isResolved: true }]]]),
      }),
    });

    expect(withoutThread.rows[0]).toMatchObject({ kind: "line", reviewHeight: 0 });
    expect(expanded.rows[0]).toMatchObject({
      kind: "line",
      reviewHeight: INLINE_FORGE_DISCUSSION_HEIGHT,
    });
    expect(collapsed.rows[0]).toMatchObject({
      kind: "line",
      reviewHeight: INLINE_COLLAPSED_FORGE_DISCUSSION_HEIGHT,
    });
    expect(resolved.rows[0]).toMatchObject({
      kind: "line",
      reviewHeight: INLINE_RESOLVED_FORGE_DISCUSSION_HEIGHT,
    });
  });

  it("shares loaded typography and its text measurer across mounts", async () => {
    const cache = createDiffDocumentWorkspaceCache();
    const { measureText } = countingMeasurer();
    let loadCount = 0;
    let measurerCount = 0;
    const typography = { family: "monospace", size: 12, lineHeight: 18 };
    const resource = cache.typography({
      typography,
      load: async () => {
        loadCount += 1;
      },
      createMeasurer: () => {
        measurerCount += 1;
        return measureText;
      },
    });
    const reused = cache.typography({
      typography: { ...typography },
      load: async () => {
        loadCount += 1;
      },
      createMeasurer: () => {
        measurerCount += 1;
        return measureText;
      },
    });

    expect(reused).toBe(resource);
    expect(measurerCount).toBe(1);
    await Promise.all([resource.load(), reused.load()]);
    expect(loadCount).toBe(1);
    expect(resource.isReady()).toBe(true);
  });
});
