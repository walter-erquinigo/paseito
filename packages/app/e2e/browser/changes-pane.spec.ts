import { execFileSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildSettingsSectionRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  openChangesPanel,
  openFilesPanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

interface DirtyWorkspace {
  id: string;
  repoPath: string;
  editedLineCount: number;
}

interface WorkspaceFixtureOptions {
  includeDeletedFile?: boolean;
  includeNestedFolders?: boolean;
  includeRenamedFile?: boolean;
  includeUntrackedFile?: boolean;
}

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@paseo:app-settings";

async function failNextDiscardRequest(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      if (typeof message === "string") {
        const envelope = JSON.parse(message) as {
          message?: { type?: string; cwd?: string; requestId?: string };
        };
        if (envelope.message?.type === "checkout.discard_changes.request") {
          browserSocket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "checkout.discard_changes.response",
                payload: {
                  cwd: envelope.message.cwd,
                  success: false,
                  error: {
                    code: "UNKNOWN",
                    message: "Injected revert failure",
                  },
                  requestId: envelope.message.requestId,
                },
              },
            }),
          );
          return;
        }
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => browserSocket.send(message));
  });
}

const CHANGES_PREFERENCES_KEY = "@paseo:changes-preferences";

const BEFORE = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds };
}
`;

const AFTER = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

interface DeriveRenderMountedTabIdsInput {
  activeTabId: string | null;
  availableTabIds: Set<string>;
  cap: number;
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function deriveRenderMountedTabIds(input: DeriveRenderMountedTabIdsInput): Set<string> {
  const { activeTabId, availableTabIds, cap, mountedTabIds } = input;
  if (!activeTabId || !availableTabIds.has(activeTabId) || mountedTabIds.has(activeTabId)) {
    return mountedTabIds;
  }

  const next = new Set<string>([activeTabId]);
  const maxSize = Math.max(1, cap);
  for (const tabId of mountedTabIds) {
    if (next.size >= maxSize) {
      break;
    }
    if (availableTabIds.has(tabId)) {
      next.add(tabId);
    }
  }
  return next;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);
  const renderMountedTabIds = useMemo(
    () =>
      deriveRenderMountedTabIds({
        activeTabId,
        availableTabIds,
        cap,
        mountedTabIds,
      }),
    [activeTabId, availableTabIds, cap, mountedTabIds],
  );

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds: renderMountedTabIds };
}
`;

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("line review controls stay in the fixed gutter across diff layouts", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectLineReviewControls(page, workspace.editedLineCount);
  const reviewCheckboxes = page.getByTestId(/^diff-line-review-/);
  const selectedReviewLine = page.locator('[data-paseito-review-selected="true"]');
  const reviewFocusMarker = page.getByTestId(/^diff-review-focus-/);
  await reviewCheckboxes.nth(1).click();
  await expect(reviewCheckboxes.nth(1)).toHaveAccessibleName(/unreviewed$/);
  await expect(page.getByTestId("line-review-shortcut-hint")).toContainText("⌘; focus Changes");
  await expect(reviewFocusMarker).toHaveCount(1);
  await expect(reviewFocusMarker).toHaveAttribute(
    "data-testid",
    `diff-review-focus-${await getReviewTargetKey(reviewCheckboxes.nth(1))}`,
  );
  await expect(selectedReviewLine).toHaveAttribute(
    "data-paseito-review-target-key",
    await reviewCheckboxes
      .nth(1)
      .getAttribute("data-testid")
      .then((testID) => testID?.replace("diff-line-review-", "") ?? ""),
  );
  await page.keyboard.press("Comma");
  await expect(reviewFocusMarker).toHaveAttribute(
    "data-testid",
    `diff-review-focus-${await getReviewTargetKey(reviewCheckboxes.nth(0))}`,
  );
  await expect(selectedReviewLine).toHaveAttribute(
    "data-paseito-review-target-key",
    await reviewCheckboxes
      .nth(0)
      .getAttribute("data-testid")
      .then((testID) => testID?.replace("diff-line-review-", "") ?? ""),
  );
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await expect(selectedReviewLine).toHaveAttribute(
    "data-paseito-review-target-key",
    await reviewCheckboxes
      .nth(0)
      .getAttribute("data-testid")
      .then((testID) => testID?.replace("diff-line-review-", "") ?? ""),
  );
  await reviewCheckboxes.nth(1).click();

  await reviewCheckboxes.nth(2).click();
  await expect(reviewCheckboxes.nth(2)).toHaveAccessibleName(/unreviewed$/);
  await page.keyboard.press("m");
  await expect(reviewFocusMarker).toHaveAttribute(
    "data-testid",
    `diff-review-focus-${await getReviewTargetKey(reviewCheckboxes.nth(3))}`,
  );
  await expect(selectedReviewLine).toHaveAttribute(
    "data-paseito-review-target-key",
    await reviewCheckboxes
      .nth(3)
      .getAttribute("data-testid")
      .then((testID) => testID?.replace("diff-line-review-", "") ?? ""),
  );
  await reviewCheckboxes.nth(2).click();
  await expect(page.getByTestId(/^diff-file-review-/).first()).toHaveAccessibleName(
    "Mark file reviewed",
  );

  await page.setViewportSize({ width: 1400, height: 600 });
  const lowerSelectedCheckbox = reviewCheckboxes.nth(20);
  const offscreenTargetCheckbox = reviewCheckboxes.nth(21);
  const offscreenTargetKey = await getReviewTargetKey(offscreenTargetCheckbox);
  await lowerSelectedCheckbox.click();
  await page.evaluate((targetKey) => {
    const target = document.querySelector<HTMLElement>(
      `[data-paseito-review-target-key="${CSS.escape(targetKey)}"]`,
    );
    let viewport = target?.parentElement ?? null;
    while (viewport) {
      const style = getComputedStyle(viewport);
      if (
        viewport.scrollHeight > viewport.clientHeight &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        break;
      }
      viewport = viewport.parentElement;
    }
    if (!viewport || !target) throw new Error("Review navigation viewport is unavailable");
    const viewportBounds = viewport.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    viewport.scrollTop = Math.max(
      0,
      viewport.scrollTop + targetBounds.top - (viewportBounds.bottom + 4),
    );
  }, offscreenTargetKey);
  await expect
    .poll(() =>
      page.evaluate((targetKey) => {
        const target = document.querySelector<HTMLElement>(
          `[data-paseito-review-target-key="${CSS.escape(targetKey)}"]`,
        );
        let viewport = target?.parentElement ?? null;
        while (viewport) {
          const style = getComputedStyle(viewport);
          if (
            viewport.scrollHeight > viewport.clientHeight &&
            (style.overflowY === "auto" || style.overflowY === "scroll")
          ) {
            break;
          }
          viewport = viewport.parentElement;
        }
        if (!viewport || !target) return false;
        return target.getBoundingClientRect().top > viewport.getBoundingClientRect().bottom;
      }, offscreenTargetKey),
    )
    .toBe(true);
  await page.keyboard.press("m");
  await expect(reviewFocusMarker).toHaveAttribute(
    "data-testid",
    `diff-review-focus-${offscreenTargetKey}`,
  );
  await expect
    .poll(() =>
      page.evaluate((targetKey) => {
        const target = document.querySelector<HTMLElement>(
          `[data-paseito-review-target-key="${CSS.escape(targetKey)}"]`,
        );
        let viewport = target?.parentElement ?? null;
        while (viewport) {
          const style = getComputedStyle(viewport);
          if (
            viewport.scrollHeight > viewport.clientHeight &&
            (style.overflowY === "auto" || style.overflowY === "scroll")
          ) {
            break;
          }
          viewport = viewport.parentElement;
        }
        if (!viewport || !target) return Number.POSITIVE_INFINITY;
        const viewportBounds = viewport.getBoundingClientRect();
        const targetBounds = target.getBoundingClientRect();
        return Math.abs(
          (targetBounds.top + targetBounds.bottom) / 2 -
            (viewportBounds.top + viewportBounds.bottom) / 2,
        );
      }, offscreenTargetKey),
    )
    .toBeLessThan(30);
  await lowerSelectedCheckbox.click();
  await expect(page.getByTestId(/^diff-file-review-/).first()).toHaveAccessibleName(
    "Mark file reviewed",
  );
  await page.setViewportSize({ width: 1400, height: 900 });

  const unifiedCheckbox = page.getByTestId(/^diff-line-review-/).first();
  await expectCheckboxFixedWhileCodeScrolls(page, 0, unifiedCheckbox);

  await page.getByTestId("changes-options-menu").click();
  await page.getByTestId("changes-toggle-wrap-lines").click();
  await expectLineReviewControls(page, workspace.editedLineCount);
  await expect(page.getByTestId("diff-file-0-horizontal-scroll")).toHaveCount(0);

  await page.getByTestId("changes-options-menu").click();
  await page.getByTestId("changes-toggle-wrap-lines").click();
  await page.getByTestId("changes-options-menu").click();
  await page.getByTestId("changes-toggle-layout").click();
  await expectLineReviewControls(page, workspace.editedLineCount);
  await expectCheckboxFixedWhileCodeScrolls(
    page,
    0,
    page.getByTestId(/^diff-line-review-/).first(),
  );
});

test("Changes keyboard focus, full expansion, and source search share one review surface", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const agentPrompt = page.getByRole("textbox", { name: "Message agent..." }).first();
  await agentPrompt.focus();
  await expect(agentPrompt).toBeFocused();
  const commentScrollTop = await page
    .getByTestId("git-diff-scroll")
    .evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "Add review comment" }).first().click();
  const commentInput = page.getByTestId("inline-review-editor-input");
  await expect(commentInput).toBeFocused();
  await expect(page.locator('[data-paseito-review-selected="true"]')).toHaveCount(0);
  await expect
    .poll(() => page.getByTestId("git-diff-scroll").evaluate((element) => element.scrollTop))
    .toBe(commentScrollTop);
  await commentInput.fill("Focus stays in this review comment");
  await expect(commentInput).toHaveValue("Focus stays in this review comment");
  await expect(agentPrompt).toHaveValue("");
  await page.getByTestId("inline-review-editor-cancel").click();

  const checkboxes = page.getByTestId(/^diff-line-review-/);
  await checkboxes.nth(3).click();
  const selectedKey = await getReviewTargetKey(checkboxes.nth(3));
  await page.keyboard.press("Meta+l");
  await expect(page.getByTestId("message-input-root")).toContainText("");
  await page.keyboard.press("Meta+;");
  await expect(
    page.locator(
      `[data-paseito-review-target-key="${selectedKey}"][data-paseito-review-selected="true"]`,
    ),
  ).toBeVisible();
  await expect(page.getByTestId("git-diff-scroll")).toBeFocused();

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await openFilesPanel(page);
  await expect(panel).toBeHidden();
  await page.keyboard.press("Meta+;");
  await expect(panel).toBeVisible();
  await expect(
    panel.locator(
      `[data-paseito-review-target-key="${selectedKey}"][data-paseito-review-selected="true"]`,
    ),
  ).toBeVisible();

  const fileToggle = panel.getByTestId("diff-file-0-toggle");
  await fileToggle.click();
  const collapsedScrollTop = await panel
    .getByTestId("git-diff-scroll")
    .evaluate((element) => element.scrollTop);
  await fileToggle.click();
  await expect
    .poll(() => panel.getByTestId("git-diff-scroll").evaluate((element) => element.scrollTop))
    .toBe(collapsedScrollTop);

  const hiddenBefore = await panel.getByTestId("diff-context-control").count();
  expect(hiddenBefore).toBeGreaterThan(0);
  const expandFile = panel.getByTestId("diff-file-0-expand-file");
  await expandFile.scrollIntoViewIfNeeded();
  await panel.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop = Math.max(1, element.scrollTop + 80);
  });
  const expansionScrollTop = await panel
    .getByTestId("git-diff-scroll")
    .evaluate((element) => element.scrollTop);
  expect(expansionScrollTop).toBeGreaterThan(0);
  const expansionAnchor = panel.locator('[data-paseito-review-selected="true"]');
  const anchorTopBefore = (await expansionAnchor.boundingBox())?.y;
  expect(anchorTopBefore).toBeDefined();
  await expandFile.click();
  await expect(panel.getByTestId("diff-context-control")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(async () => {
      const top = (await expansionAnchor.boundingBox())?.y;
      return top === undefined || anchorTopBefore === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(top - anchorTopBefore);
    })
    .toBeLessThan(2);
  await expect(panel.getByTestId("git-diff-scroll")).toBeFocused();

  await page.keyboard.press("/");
  const search = panel.getByTestId("changes-search-input");
  await expect(search).toBeFocused();
  await search.fill("deriveRenderMountedTabIds");
  await search.press("Enter");
  await expect(panel.getByTestId("changes-search-status")).toContainText(/^1\/\d+/);
  await expect(page.locator('[data-paseito-diff-navigation-selected="true"]')).toBeVisible();
  await page.keyboard.press("n");
  await expect(panel.getByTestId("changes-search-status")).toContainText(/^2\/\d+/);
  await page.keyboard.press("Shift+n");
  await expect(panel.getByTestId("changes-search-status")).toContainText(/^1\/\d+/);
  await page.keyboard.press("Escape");
  await expect(panel.getByTestId("changes-search-bar")).toHaveCount(0);
});

test("inline review comments retain focus beside an agent pane", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const agentPrompt = page
    .getByRole("textbox", { name: "Message agent..." })
    .filter({ visible: true });
  await expect(agentPrompt).toHaveCount(1);
  await agentPrompt.focus();
  await expect(agentPrompt).toBeFocused();

  await panel.getByRole("button", { name: "Add review comment" }).first().click();
  const commentInput = panel.getByTestId("inline-review-editor-input");
  await expect(commentInput).toBeFocused();

  await agentPrompt.click();
  await expect(agentPrompt).toBeFocused();
  await commentInput.click();
  await expect(commentInput).toBeFocused();
  await commentInput.pressSequentially("Comment focus stays in Changes");
  await expect(commentInput).toHaveValue("Comment focus stays in Changes");
  await expect(agentPrompt).toHaveValue("");
});

test("opening an inline comment preserves the viewport or reveals only the clipped editor", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await page.setViewportSize({ width: 1400, height: 600 });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const reviewCheckboxes = page.getByTestId(/^diff-line-review-/);
  await reviewCheckboxes.nth(1).click();

  const commentButtons = page.getByRole("button", {
    name: "Add review comment",
  });
  const middleCommentButton = commentButtons.nth(14);
  await middleCommentButton.evaluate((element) => {
    let viewport = element.parentElement;
    while (viewport) {
      const style = getComputedStyle(viewport);
      if (
        viewport.scrollHeight > viewport.clientHeight &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        break;
      }
      viewport = viewport.parentElement;
    }
    if (!viewport) throw new Error("Inline comment viewport is unavailable");
    const viewportBounds = viewport.getBoundingClientRect();
    const targetBounds = element.getBoundingClientRect();
    viewport.scrollTop += targetBounds.top - (viewportBounds.top + 80);
  });
  const middleScrollTop = await page
    .getByTestId("git-diff-scroll")
    .evaluate((element) => element.scrollTop);
  await middleCommentButton.click();
  await expect(page.getByTestId("inline-review-editor-input")).toBeFocused();
  await expect
    .poll(() => page.getByTestId("git-diff-scroll").evaluate((element) => element.scrollTop))
    .toBe(middleScrollTop);
  await page.getByTestId("inline-review-editor-cancel").click();

  const lowerCommentButton = commentButtons.nth(27);
  await lowerCommentButton.evaluate((element) => {
    let viewport = element.parentElement;
    while (viewport) {
      const style = getComputedStyle(viewport);
      if (
        viewport.scrollHeight > viewport.clientHeight &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        break;
      }
      viewport = viewport.parentElement;
    }
    if (!viewport) throw new Error("Inline comment viewport is unavailable");
    const viewportBounds = viewport.getBoundingClientRect();
    const targetBounds = element.getBoundingClientRect();
    viewport.scrollTop += targetBounds.bottom - (viewportBounds.bottom - 4);
  });
  const lowerScrollTop = await page
    .getByTestId("git-diff-scroll")
    .evaluate((element) => element.scrollTop);
  await lowerCommentButton.click();
  const editor = page.getByTestId("inline-review-editor");
  await expect(page.getByTestId("inline-review-editor-input")).toBeFocused();
  await expect
    .poll(async () => {
      const editorBounds = await editor.boundingBox();
      const viewportBounds = await page.getByTestId("git-diff-scroll").boundingBox();
      if (!editorBounds || !viewportBounds) return Number.POSITIVE_INFINITY;
      return Math.abs(
        editorBounds.y + editorBounds.height - (viewportBounds.y + viewportBounds.height),
      );
    })
    .toBeLessThan(2);
  await expect
    .poll(() => page.getByTestId("git-diff-scroll").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(lowerScrollTop);
});

test("saved inline comments keep the fixed gutter aligned with code rows", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const commentButtons = page.getByTestId(/^diff-review-gutter-(?!action-)/);
  const targetButton = commentButtons.first();
  const gutterTestID = await targetButton.getAttribute("data-testid");
  const targetKey = gutterTestID?.replace("diff-review-gutter-", "");
  expect(targetKey).toBeTruthy();
  const targetKeys = await commentButtons.evaluateAll((buttons) =>
    buttons.slice(0, 12).map((button) => {
      const testID = button.getAttribute("data-testid") ?? "";
      return testID.replace("diff-review-gutter-", "");
    }),
  );

  await clickReviewCommentGutter(targetButton);
  await page
    .getByTestId("inline-review-editor-input")
    .fill(
      "I don't want to use the existing parser here because it accepts negative numbers. Write a one-element parser.",
    );
  await page.getByTestId("inline-review-editor-save").click();
  await expect(
    page.getByText("I don't want to use the existing parser here", {
      exact: false,
    }),
  ).toBeVisible();

  const secondTargetButton = page.getByTestId(`diff-review-gutter-${targetKeys[4]}`);
  await clickReviewCommentGutter(secondTargetButton);
  await page
    .getByTestId("inline-review-editor-input")
    .fill("This second two-line comment must not add another fractional gutter offset.");
  await page.getByTestId("inline-review-editor-save").click();
  await expect(page.getByText("This second two-line comment", { exact: false })).toBeVisible();

  const rowOffsets = await page.evaluate(
    (keys) =>
      keys.map((key) => {
        const gutter = document.querySelector<HTMLElement>(
          `[data-testid="diff-review-gutter-${CSS.escape(key)}"]`,
        );
        const canvasRow = document.querySelector<HTMLElement>(
          `[data-testid="diff-canvas-row-${CSS.escape(key)}"]`,
        );
        if (!gutter || !canvasRow) throw new Error(`Diff row ${key} is unavailable`);
        return gutter.getBoundingClientRect().top - canvasRow.getBoundingClientRect().top;
      }),
    targetKeys,
  );
  expect(rowOffsets).toHaveLength(12);
  expect(Math.max(...rowOffsets.map(Math.abs))).toBeLessThan(1);
});

test("changes file actions open from the kebab and right-click", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeDeletedFile: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expect(page.getByTestId("diff-file-1")).toContainText("zz-deleted.ts");
  const deletedFileName = page.getByText("zz-deleted.ts", { exact: true });
  await expect(deletedFileName).toHaveCSS("user-select", "none");
  await deletedFileName.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect(page.getByTestId(/diff-file-\d+-actions/)).toHaveCount(0);
  await page.getByTestId("diff-file-1-toggle").click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await page.getByText("Copy path", { exact: true }).click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await expect(page.getByTestId("diff-file-1-open-file")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const fileRow = page.getByTestId("diff-file-0-toggle");
  const fileRowBounds = await fileRow.boundingBox();
  expect(fileRowBounds).not.toBeNull();
  await fileRow.click({ button: "right", position: { x: 80, y: 10 } });
  await expect(page.getByTestId("diff-file-0-open-file")).toBeVisible();
  const menuBounds = await page.getByTestId("diff-file-0-context-menu").boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(Math.abs(menuBounds!.x - (fileRowBounds!.x + 80))).toBeLessThanOrEqual(1);
  expect(menuBounds!.y).toBeGreaterThan(fileRowBounds!.y + 10);
  await page.getByTestId("diff-file-0-open-file").click();

  await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-file_src/use-mounted-tab-set.ts")).toBeVisible();
});

test("changes context menus duplicate files and folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-duplicate").click();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set copy.ts"), "utf8"))
    .toBe(AFTER);

  await page.getByTestId("changes-toggle-tree").click();
  await page.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-duplicate").click();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src copy/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);
});

test("changes context menu recursively collapses descendant folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeNestedFolders: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("changes-toggle-tree").click();
  const tree = page.getByTestId("changes-file-tree");
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(tree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();

  await tree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-collapse-folder").click();
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toHaveCount(0);

  await tree.getByTestId("diff-folder-src-toggle").click();
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(tree.getByText("root.ts", { exact: true })).toHaveCount(0);

  await tree.getByTestId("diff-folder-src/zz-folder-toggle").click();
  await expect(tree.getByText("root.ts", { exact: true })).toBeVisible();
  await expect(tree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();
  await expect(tree.getByText("changed.ts", { exact: true })).toHaveCount(0);

  await tree.getByTestId("diff-folder-src/zz-folder/nested-toggle").click();
  await expect(tree.getByText("changed.ts", { exact: true })).toBeVisible();
});

test("changes context menus expose folder revert and restore a file after confirmation", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("changes-toggle-tree").click();
  await page.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  const folderRevert = page.getByTestId("diff-folder-src-revert");
  await expect(folderRevert).toBeVisible();
  const revertLabelColor = await folderRevert
    .getByText("Discard changes", { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(folderRevert.locator("svg")).toHaveCSS("stroke", revertLabelColor);
  await page.keyboard.press("Escape");

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const cancelledConfirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      resolve(message);
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  expect(await cancelledConfirmation).toContain("src/use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      resolve(message);
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  expect(await confirmation).toContain("src/use-mounted-tab-set.ts");

  await expect(page.getByTestId("diff-file-0")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(BEFORE);
});

test("discarding a staged rename restores its source path", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeRenamedFile: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const renamedToggle = page
    .getByTestId(/^diff-file-\d+-toggle$/)
    .filter({ hasText: "zz-renamed.ts" });
  const toggleTestId = await renamedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await renamedToggle.click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await confirmation;

  await expect(page.getByText("zz-renamed.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/rename-source.ts"), "utf8"))
    .toBe("export const renamed = true;\n");
});

test("discarding an untracked file removes it from the working tree", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeUntrackedFile: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const untrackedToggle = page
    .getByTestId(/^diff-file-\d+-toggle$/)
    .filter({ hasText: "zz-untracked.txt" });
  const toggleTestId = await untrackedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await untrackedToggle.click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await confirmation;

  await expect(page.getByText("zz-untracked.txt", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    readFile(path.join(workspace.repoPath, "zz-untracked.txt"), "utf8"),
  ).rejects.toThrow();
});

test("shows a revert error returned by the daemon", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await failNextDiscardRequest(page);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  await confirmation;

  await expect(page.getByText("Injected revert failure", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);
});

test("Changes keeps pane-local navigation stable while other pane views open", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeDeletedFile: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await panel.getByTestId("changes-toggle-tree").click();
  await expect(panel.getByTestId("changes-tree-rail")).toBeVisible();

  await openFilesPanel(page);
  await expect(panel).toBeHidden();
  await openChangesPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("changes-tree-rail")).toBeVisible();

  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), BEFORE);
  await expect(panel.getByText("use-mounted-tab-set.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(panel).toContainText("zz-deleted.ts");
  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), AFTER);
  await expect(panel.getByTestId("diff-file-0-name")).toHaveText("use-mounted-tab-set.ts", {
    timeout: 30_000,
  });
});

test("Changes toggles its optional tree rail without replacing the diff", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectFlatFileList(page);

  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-options-menu-content")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-layout")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("changes-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("changes-refresh")).toContainText("Refresh");
  await page.getByTestId("changes-toggle-whitespace").click();
  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Show whitespace");
  await page.keyboard.press("Escape");

  await page.getByTestId("changes-toggle-tree").click();
  await expect(page.getByTestId("diff-folder-src")).toBeVisible();
  await expect(page.getByTestId("diff-folder-src").getByText("src", { exact: true })).toHaveCSS(
    "user-select",
    "none",
  );
  await expect(page.getByTestId("diff-tree-file-0")).toBeVisible();
  await expect(page.getByTestId("diff-folder-src-toggle").locator("svg")).toHaveCount(1);
  const folderToggleBounds = await page.getByTestId("diff-folder-src-toggle").boundingBox();
  const folderChevronBounds = await page
    .getByTestId("diff-folder-src-toggle")
    .locator("svg")
    .boundingBox();
  expect(folderToggleBounds).not.toBeNull();
  expect(folderChevronBounds).not.toBeNull();
  expect(folderChevronBounds!.y + folderChevronBounds!.height / 2).toBeCloseTo(
    folderToggleBounds!.y + folderToggleBounds!.height / 2,
    0,
  );
  const folderLabelBounds = await page
    .getByTestId("diff-folder-src")
    .getByText("src", { exact: true })
    .boundingBox();
  const fileLabelBounds = await page
    .getByTestId("diff-tree-file-0")
    .getByText("use-mounted-tab-set.ts", { exact: true })
    .boundingBox();
  expect(folderLabelBounds).not.toBeNull();
  expect(fileLabelBounds).not.toBeNull();
  expect(fileLabelBounds!.x - folderLabelBounds!.x).toBeCloseTo(12, 0);

  const folderToggle = page.getByTestId("diff-folder-src-toggle");
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("diff-tree-file-0")).toHaveCount(0);
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("diff-tree-file-0")).toBeVisible();

  const fileToggle = page.getByTestId("diff-tree-file-0-toggle");
  await fileToggle.click({ button: "right" });
  await expect(fileToggle).toHaveAttribute("aria-selected", "true");
  await expect(folderToggle).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("diff-tree-file-0-context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("diff-folder-src-toggle").click();
  await expect(page.getByTestId("diff-tree-file-0")).toHaveCount(0);

  await page.getByTestId("changes-toggle-tree").click();
  await expectFlatFileList(page);
});

test("changes diff applies code size changes to gutter and code typography", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 12);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await changeCodeFontSizeFromSettings(page, 18);
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);

  await expectDiffCodeFontSize(page, 18);
  await expectVisibleDiffRowsShareTypography(page);
});

test("Changes LSP navigates a clean C++ revision and pauses while the workspace is dirty", async ({
  page,
}) => {
  const workspace = await createCleanCommittedCppWorkspace();
  await useUnwrappedDiffLines(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page, "main.cc");
  await expect(page.getByTestId("git-diff-canvas-root")).toBeVisible();

  await page
    .getByTestId("diff-file-0-toggle")
    .click({ button: "right", position: { x: 80, y: 10 } });
  await page.getByTestId("diff-file-0-open-file").click();
  await expect(page.getByTestId("workspace-file-pane")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("file-lsp-menu").click();
  await page.getByTestId("file-lsp-workspace-toggle").click();
  await expect(page.getByTestId("file-lsp-menu")).toContainText("clangd", { timeout: 30_000 });
  await page.keyboard.press("Escape");

  await openChangesPanel(page);
  await expect(page.getByTestId("git-diff-canvas-root")).toBeVisible({ timeout: 30_000 });
  const fileLsp = page.getByTestId("changes-lsp-src/main.cc-menu");
  await expect(fileLsp).toContainText("clangd", { timeout: 30_000 });

  const addPosition = await sourceTokenPosition(page, "return add(3, 4);", "add");
  await page.mouse.move(addPosition.x, addPosition.y);
  await expect(page.getByTestId("changes-lsp-hover")).toContainText("add", {
    timeout: 30_000,
  });
  await page.getByTestId("git-diff-scroll").focus();
  await page.mouse.move(addPosition.x, addPosition.y);
  await page.keyboard.press("F12");
  await expect(page.getByTestId("workspace-file-pane")).toBeVisible({ timeout: 30_000 });
  await openChangesPanel(page);
  await expect(fileLsp).toBeVisible({ timeout: 30_000 });

  await writeFile(path.join(workspace.repoPath, "README.md"), "dirty\n");
  await expect(fileLsp).toHaveText("LSP paused", { timeout: 30_000 });
  await expect(page.getByTestId("changes-lsp-hover")).toHaveCount(0);
  await fileLsp.click();
  await expect(page.getByTestId("changes-lsp-src/main.cc-paused")).toContainText(
    "Clean the workspace to resume",
  );
  await page.keyboard.press("Escape");

  execFileSync("git", ["checkout", "--", "README.md"], { cwd: workspace.repoPath });
  await expect(fileLsp).toContainText("clangd", { timeout: 30_000 });
});

async function useCodeFont(page: Page, codeFontSize: number): Promise<void> {
  await page.addInitScript(
    ({ settingsKey, fontSize }) => {
      if (localStorage.getItem(settingsKey)) {
        return;
      }
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          theme: "dark",
          sendBehavior: "queue",
          serviceUrlBehavior: "ask",
          terminalScrollbackLines: 10_000,
          uiFontFamily: "",
          monoFontFamily: "",
          uiFontSize: 16,
          codeFontSize: fontSize,
          syntaxTheme: "one",
        }),
      );
    },
    { settingsKey: APP_SETTINGS_KEY, fontSize: codeFontSize },
  );
}

async function useUnwrappedDiffLines(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: "unified",
          viewMode: "flat",
          wrapLines: false,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY },
  );
}

async function expectFlatFileList(page: Page): Promise<void> {
  await expect(page.locator('[data-testid^="diff-folder-"]')).toHaveCount(0);
  await expect(page.getByTestId("diff-file-0")).toContainText("use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toContainText("src");
}

async function expectLineReviewControls(page: Page, editedLineCount: number): Promise<void> {
  const controls = page.getByTestId(/^diff-line-review-/);
  await expect(controls).toHaveCount(editedLineCount);
  await expect(controls.first()).toBeVisible();
  await expect(page.getByTestId(/^diff-file-review-/).first()).toHaveAccessibleName(
    "Mark file reviewed",
  );
}

async function getReviewTargetKey(checkbox: Locator): Promise<string> {
  const testID = await checkbox.getAttribute("data-testid");
  if (!testID?.startsWith("diff-line-review-")) {
    throw new Error("Line review checkbox has no target key");
  }
  return testID.slice("diff-line-review-".length);
}

async function clickReviewCommentGutter(gutter: Locator): Promise<void> {
  const bounds = await gutter.boundingBox();
  if (!bounds) throw new Error("Review comment gutter is unavailable");
  await gutter.click({ position: { x: Math.max(1, bounds.width - 2), y: bounds.height / 2 } });
}

async function expectCheckboxFixedWhileCodeScrolls(
  page: Page,
  fileIndex: number,
  checkbox: Locator,
): Promise<void> {
  await expect(checkbox).toBeVisible();
  const before = await checkbox.boundingBox();
  expect(before).not.toBeNull();
  const overflow = await page
    .getByTestId(`diff-file-${fileIndex}-horizontal-scroll`)
    .evaluate((scroll) => {
      const maxScrollLeft = scroll.scrollWidth - scroll.clientWidth;
      scroll.scrollLeft = maxScrollLeft;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
      return { maxScrollLeft, scrollLeft: scroll.scrollLeft };
    });
  expect(overflow.maxScrollLeft).toBeGreaterThan(0);
  expect(overflow.scrollLeft).toBeGreaterThan(0);
  const after = await checkbox.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).toBeCloseTo(before!.x, 0);
}

async function expectDiffCodeFontSize(page: Page, fontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      return page
        .getByTestId("git-diff-canvas")
        .evaluate((canvas) => Number.parseFloat(getComputedStyle(canvas).fontSize));
    })
    .toBe(fontSize);
}

async function expectVisibleDiffRowsShareTypography(page: Page): Promise<void> {
  const metrics = await page.getByTestId("git-diff-canvas-root").evaluate((root) => {
    const canvas = root.querySelector<HTMLElement>('[data-testid="git-diff-canvas"]');
    if (!canvas) throw new Error("Diff canvas is unavailable");
    const fontSize = Number.parseFloat(getComputedStyle(canvas).fontSize);
    const rowHeights = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid^="diff-canvas-row-"]'),
      (row) => row.getBoundingClientRect().height,
    );
    const gutterHeights = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[data-testid^="diff-review-gutter-"]:not([data-testid^="diff-review-gutter-action-"])',
      ),
      (gutter) => gutter.getBoundingClientRect().height,
    );
    return { fontSize, rowHeights, gutterHeights };
  });
  const expectedLineHeight = Math.round(metrics.fontSize * 1.5);
  expect(metrics.rowHeights.length).toBeGreaterThan(0);
  expect(metrics.gutterHeights.length).toBeGreaterThan(0);
  for (const height of [...metrics.rowHeights, ...metrics.gutterHeights]) {
    expect(height).toBeCloseTo(expectedLineHeight, 0);
  }
}

async function createWorkspaceWithMountedTabDiff(
  options: WorkspaceFixtureOptions = {},
): Promise<DirtyWorkspace> {
  const files = [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }];
  if (options.includeDeletedFile) {
    files.push({
      path: "src/zz-deleted.ts",
      content: "export const deleted = true;\n",
    });
  }
  if (options.includeRenamedFile) {
    files.push({
      path: "src/rename-source.ts",
      content: "export const renamed = true;\n",
    });
  }
  if (options.includeNestedFolders) {
    files.push(
      { path: "src/zz-folder/root.ts", content: "export const root = 1;\n" },
      {
        path: "src/zz-folder/nested/changed.ts",
        content: "export const nested = 1;\n",
      },
    );
  }
  const repo = await createTempGitRepo("changes-pane-", { files });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), AFTER);
  if (options.includeUntrackedFile) {
    await writeFile(path.join(repo.path, "zz-untracked.txt"), "remove me\n");
  }
  const editedLineCount = execFileSync(
    "git",
    ["diff", "--unified=0", "--", "src/use-mounted-tab-set.ts"],
    { cwd: repo.path },
  )
    .toString()
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---")),
    )
    .filter((line) => {
      const content = line.slice(1).trim();
      return content !== "" && content !== "];" && content !== "};" && content !== "}";
    }).length;
  if (options.includeDeletedFile) {
    await unlink(path.join(repo.path, "src/zz-deleted.ts"));
  }
  if (options.includeRenamedFile) {
    execFileSync("git", ["mv", "src/rename-source.ts", "src/zz-renamed.ts"], {
      cwd: repo.path,
    });
  }
  if (options.includeNestedFolders) {
    await writeFile(path.join(repo.path, "src/zz-folder/root.ts"), "export const root = 2;\n");
    await writeFile(
      path.join(repo.path, "src/zz-folder/nested/changed.ts"),
      "export const nested = 2;\n",
    );
  }
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return {
    id: createdWorkspace.workspace.id,
    repoPath: repo.path,
    editedLineCount,
  };
}

async function createCleanCommittedCppWorkspace(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-lsp-", {
    withRemote: true,
    files: [
      {
        path: "src/main.cc",
        content:
          "int add(int lhs, int rhs) { return lhs + rhs; }\nint main() { return add(1, 2); }\n",
      },
    ],
  });
  await writeFile(path.join(repo.path, ".git/info/exclude"), "remote.git/\n");
  execFileSync("git", ["checkout", "-b", "feature/lsp-changes"], { cwd: repo.path });
  await writeFile(
    path.join(repo.path, "src/main.cc"),
    "int add(int lhs, int rhs) { return lhs + rhs; }\nint main() { return add(3, 4); }\n",
  );
  execFileSync("git", ["add", "src/main.cc"], { cwd: repo.path });
  execFileSync("git", ["commit", "-m", "Change add arguments"], { cwd: repo.path });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path, editedLineCount: 2 };
}

async function sourceTokenPosition(
  page: Page,
  lineText: string,
  tokenText: string,
): Promise<{ x: number; y: number }> {
  return page.locator("body").evaluate(
    (_, input) => {
      const markers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-paseito-diff-canvas-source-text]"),
      );
      const marker = markers.find((candidate) =>
        candidate.dataset.paseitoDiffCanvasSourceText?.includes(input.lineText),
      );
      if (!marker) throw new Error(`Could not find Changes source line: ${input.lineText}`);
      const sourceText = marker.dataset.paseitoDiffCanvasSourceText ?? "";
      const tokenIndex = sourceText.indexOf(input.tokenText);
      if (tokenIndex < 0)
        throw new Error(`Could not find Changes source token: ${input.tokenText}`);
      const root = marker.closest<HTMLElement>('[data-testid="git-diff-canvas-root"]');
      const canvas = root?.querySelector<HTMLElement>('[data-testid="git-diff-canvas"]');
      const sourceX = Number(marker.dataset.paseitoDiffCanvasSourceX);
      if (!root || !canvas || !Number.isFinite(sourceX)) {
        throw new Error("Changes canvas geometry is unavailable");
      }
      const style = getComputedStyle(canvas);
      const measurer = document.createElement("canvas").getContext("2d");
      if (!measurer) throw new Error("Canvas text measurement is unavailable");
      measurer.font = `${style.fontSize} ${style.fontFamily}`;
      const prefix = sourceText.slice(0, tokenIndex);
      const tokenCenter = measurer.measureText(`${prefix}${input.tokenText}`).width;
      const tokenWidth = measurer.measureText(input.tokenText).width;
      const rootBounds = root.getBoundingClientRect();
      const markerBounds = marker.getBoundingClientRect();
      return {
        x: rootBounds.left + sourceX + tokenCenter - tokenWidth / 2,
        y: markerBounds.top + markerBounds.height / 2,
      };
    },
    { lineText, tokenText },
  );
}

async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

async function openChangesInVisibleExplorer(
  page: Page,
  expectedFile = "use-mounted-tab-set.ts",
): Promise<void> {
  await openChangesPanel(page);
  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(panel.getByText(expectedFile, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const body = panel.getByTestId("diff-file-0-body");
  if (!(await body.isVisible())) {
    await panel.getByTestId("diff-file-0-toggle").click();
  }
  await expect(body).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel.getByTestId("git-diff-canvas-root")).toBeVisible();
}

async function changeCodeFontSizeFromSettings(page: Page, codeFontSize: number): Promise<void> {
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(new RegExp(`${buildSettingsSectionRoute("general")}|/settings$`));
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Code font size").fill(String(codeFontSize));
  await page.getByLabel("Code font size").press("Enter");
  await expect(page.getByLabel("Code font size")).toHaveValue(String(codeFontSize));
  await expectStoredCodeFontSize(page, codeFontSize);
}

async function expectStoredCodeFontSize(page: Page, codeFontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (settingsKey) => localStorage.getItem(settingsKey),
        APP_SETTINGS_KEY,
      );
      if (!raw) {
        return null;
      }
      return (JSON.parse(raw) as { codeFontSize?: number }).codeFontSize ?? null;
    })
    .toBe(codeFontSize);
}

async function returnToWorkspaceChanges(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-workspace").click();
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}
