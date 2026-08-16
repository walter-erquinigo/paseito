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
import { openChangesPanel, waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
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
  includeLargeContextGap?: boolean;
  includeNestedFolders?: boolean;
  includeRenamedFile?: boolean;
  includeUntrackedFile?: boolean;
}

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@paseo:app-settings";

function changesTree(page: Page) {
  return page.getByTestId("changes-file-tree").filter({ visible: true });
}

async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

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
                  error: { code: "UNKNOWN", message: "Injected revert failure" },
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

test("Changes opens the populated committed comparison for a clean checkout", async ({ page }) => {
  const workspace = await createWorkspaceWithCommittedDiff();

  await openWorkspaceChangesSurface(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await expect(tree.getByTestId("changes-diff-status-trigger")).toContainText("Committed");
  await expect(panel.getByText("committed-only.ts", { exact: true })).toBeVisible();
});

test("Changes expires a manual comparison when checkout dirtiness changes", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await openWorkspaceChanges(page, workspace);

  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  const mode = tree.getByTestId("changes-diff-status-trigger");
  await expect(mode).toContainText("Uncommitted");

  await mode.click();
  await page.getByTestId("changes-diff-mode-committed").click();
  await expect(mode).toContainText("Committed");
  await expect(tree.getByRole("button", { name: "See uncommitted changes" })).toBeVisible();

  execFileSync("git", ["add", "--all"], { cwd: workspace.repoPath });
  execFileSync("git", ["commit", "-m", "Commit working changes"], { cwd: workspace.repoPath });
  await expect(mode).toContainText("Committed");
  await expect(tree.getByRole("button", { name: "See uncommitted changes" })).toHaveCount(0, {
    timeout: 30_000,
  });

  await writeFile(path.join(workspace.repoPath, "new-working-change.txt"), "uncommitted\n");
  await expect(mode).toContainText("Uncommitted", { timeout: 30_000 });
});

test("an empty Changes comparison links to the populated comparison", async ({ page }) => {
  const workspace = await createWorkspaceWithCommittedDiff();
  await openWorkspaceChangesSurface(page, workspace);

  const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const tree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  const mode = tree.getByTestId("changes-diff-status-trigger");
  await mode.click();
  await page.getByTestId("changes-diff-mode-committed").click();
  await expect(panel.getByText("committed-only.ts", { exact: true })).toBeVisible();

  await mode.click();
  await page.getByTestId("changes-diff-mode-uncommitted").click();

  await expect(tree.getByText("No uncommitted changes", { exact: true })).toBeVisible();
  const seeCommitted = tree.getByRole("button", { name: "See committed changes" });
  await expect(seeCommitted).toBeVisible();
  await seeCommitted.click();
  await expect(mode).toContainText("Committed");
  await expect(panel.getByText("committed-only.ts", { exact: true })).toBeVisible();
});

test("changes file actions open below the right-click without a reserved kebab", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
test("line review controls stay in the fixed gutter across diff layouts", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectLineReviewControls(page, workspace.editedLineCount);
  const reviewCheckboxes = page.getByTestId(/^diff-line-review-/);
  await expect(reviewCheckboxes.first()).toHaveCSS("opacity", "1");
  await reviewCheckboxes.first().hover();
  await expect(reviewCheckboxes.first()).toHaveCSS("opacity", "1");
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

test("Review menu marks, clears, and organizes every changed file", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeNestedFolders: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const reviewMenu = page.getByTestId("changes-review-menu");
  const fileHeaders = page.getByTestId(/^diff-file-\d+-toggle$/);
  const fileReviewControls = page.getByTestId(/^diff-file-review-/);
  await expect(reviewMenu).toBeVisible();
  await expect(reviewMenu).toContainText(/^Review 0\//);
  await expect(fileHeaders).toHaveCount(3);
  await expect(fileReviewControls).toHaveCount(3);

  const firstStatBounds = await page.getByTestId("diff-file-0-stat").boundingBox();
  const firstReviewBounds = await fileReviewControls.first().boundingBox();
  expect(firstStatBounds).not.toBeNull();
  expect(firstReviewBounds).not.toBeNull();
  expect(firstStatBounds!.x + firstStatBounds!.width).toBeLessThanOrEqual(firstReviewBounds!.x);

  await reviewMenu.click();
  await page.getByTestId("changes-review-mark-all").click();
  for (const header of await fileHeaders.all()) {
    await expect(header).toHaveAttribute("aria-expanded", "false");
  }

  await reviewMenu.click();
  await page.getByTestId("changes-review-clear-all").click();
  await expect(fileReviewControls.first()).toHaveAccessibleName("Mark file reviewed");
  for (const header of await fileHeaders.all()) {
    await expect(header).toHaveAttribute("aria-expanded", "false");
  }

  await reviewMenu.click();
  await page.getByTestId("changes-review-organize").click();
  for (const header of await fileHeaders.all()) {
    await expect(header).toHaveAttribute("aria-expanded", "true");
  }
});

test("E opens the selected review line in a focused side editor", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const firstReviewDot = page.getByTestId(/^diff-line-review-/).first();
  await firstReviewDot.click();
  await page.keyboard.press("e");

  await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-file_src/use-mounted-tab-set.ts")).toBeVisible();
  await expect(page.getByTestId("file-source-editor")).toBeVisible();
  await expect(page.locator(".cm-editor.cm-focused")).toBeVisible();
});

test("Changes keyboard focus, full expansion, and source search share one review surface", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeLargeContextGap: true });
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
  const firstContextControl = panel.getByTestId("diff-context-control").first();
  await expect(firstContextControl).toHaveCSS("height", "28px");
  await expect(firstContextControl.getByTestId("diff-context-expand-all")).toHaveAccessibleName(
    /^Show (all )?[\d,]+( of [\d,]+)? unchanged lines$/,
  );
  await expect(panel.getByTestId("diff-context-expand-up").first()).toHaveAccessibleName(
    "Show 20 lines above",
  );
  await expect(panel.getByTestId("diff-context-expand-down").first()).toHaveAccessibleName(
    "Show 20 lines below",
  );
  const expandFile = panel.getByTestId("diff-file-0-expand-file");
  await expect(expandFile).toHaveAccessibleName(/^Show entire .+ file$/);
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
  const deletedFileName = page.getByTestId("diff-file-1-name");
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

test("canvas file headers select without toggling for context menu and long press", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const firstFile = page.getByTestId("diff-file-0-toggle");
  const deletedFile = page.getByTestId("diff-file-1-toggle");
  await deletedFile.click({ button: "right" });
  await expect(deletedFile).toHaveAttribute("aria-selected", "true");
  await expect(deletedFile).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Copy path")).toBeVisible();
  await page.keyboard.press("Escape");

  await longPressFileHeader(page, firstFile);
  await expect(firstFile).toHaveAttribute("aria-selected", "true");
  await expect(deletedFile).toHaveAttribute("aria-selected", "false");
  await expect(firstFile).toHaveAttribute("aria-expanded", "true");
});

test("every interactive file header has the same hover feedback", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const first = page.getByTestId("diff-file-0-toggle");
  const second = page.getByTestId("diff-file-1-toggle");
  const normalBackground = await first.evaluate(
    (element) => getComputedStyle(element.parentElement!).backgroundColor,
  );
  await expect
    .poll(() =>
      first.evaluate((element) => getComputedStyle(element.parentElement!).borderTopWidth),
    )
    .toBe("0px");

  await first.hover();
  const hoverBackground = await first.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(hoverBackground).not.toBe(normalBackground);

  await first.click();
  await page.mouse.move(0, 0);
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      first.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
    )
    .toBe(normalBackground);
  const [sharedBorder, secondTopBorderWidth] = await Promise.all([
    first.evaluate((element) => getComputedStyle(element.parentElement!).borderBottomColor),
    second.evaluate((element) => getComputedStyle(element.parentElement!).borderTopWidth),
  ]);
  expect(sharedBorder).not.toBe("rgba(0, 0, 0, 0)");
  expect(secondTopBorderWidth).toBe("0px");

  await first.hover();
  await expect
    .poll(() => first.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(hoverBackground);
  await second.hover();
  await expect
    .poll(() =>
      first.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
    )
    .toBe(normalBackground);
  await expect
    .poll(() => second.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(hoverBackground);
});

test("changes context menus duplicate files and folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-duplicate").click();
  await expect
    .poll(() => readFileIfPresent(path.join(workspace.repoPath, "src/use-mounted-tab-set copy.ts")))
    .toBe(AFTER);

  await changesTree(page).getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-duplicate").click();
  await expect
    .poll(() => readFileIfPresent(path.join(workspace.repoPath, "src copy/use-mounted-tab-set.ts")))
    .toBe(AFTER);
});

test("changes tree aligns every file status after its diff stat", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({
    includeDeletedFile: true,
    includeUntrackedFile: true,
  });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  const tree = changesTree(page);
  const modifiedRow = tree.getByTestId("diff-tree-file-0");
  const deletedRow = tree.getByTestId("diff-tree-file-1");
  const addedRow = tree.getByTestId("diff-tree-file-2");
  const modifiedStatus = modifiedRow.getByRole("img", { name: "Modified" });
  await expect(modifiedStatus).toBeVisible();
  await expect(deletedRow.getByRole("img", { name: "Deleted" })).toBeVisible();
  await expect(addedRow.getByRole("img", { name: "New" })).toBeVisible();

  const [statBounds, statusBounds] = await Promise.all([
    modifiedRow.getByTestId("diff-tree-file-0-stat").boundingBox(),
    modifiedStatus.boundingBox(),
  ]);
  if (!statBounds || !statusBounds) throw new Error("Changes tree trailing status has no bounds");
  expect(statusBounds.x - (statBounds.x + statBounds.width)).toBeGreaterThanOrEqual(8);
});

test("changes context menu recursively collapses descendant folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeNestedFolders: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const tree = changesTree(page);
  await expect(tree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(tree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();
  const rootRow = tree.getByTestId("diff-folder-src-toggle");
  const rootLabel = tree.getByTestId("diff-folder-src-toggle").getByText("src", { exact: true });
  await expect(rootRow).toHaveCSS("opacity", "1");
  await expect(rootLabel).toHaveCSS("opacity", "0.76");
  await rootRow.hover();
  await expect(rootLabel).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  const nestedLabel = tree
    .getByTestId("diff-folder-src/zz-folder-toggle")
    .getByText("zz-folder", { exact: true });
  const [rootBounds, nestedBounds] = await Promise.all([
    rootLabel.boundingBox(),
    nestedLabel.boundingBox(),
  ]);
  if (!rootBounds || !nestedBounds) throw new Error("Changes tree rows have no bounds");
  expect(nestedBounds.x - rootBounds.x).toBe(12);
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

  const tree = changesTree(page);
  await tree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("changes-toggle-tree").click();
  await page.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  const folderRevert = page.getByTestId("diff-folder-src-revert");
  await expect(folderRevert).toBeVisible();
  const revertLabelColor = await folderRevert
    .getByText("Discard changes", { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(folderRevert.locator("svg")).toHaveCSS("stroke", revertLabelColor);
  await page.keyboard.press("Escape");

  await tree.getByTestId("diff-tree-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const cancelledConfirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      resolve(message);
    });
  });
  await page.getByTestId("diff-tree-file-0-revert").click();
  expect(await cancelledConfirmation).toContain("src/use-mounted-tab-set.ts");
  await expect(tree.getByTestId("diff-tree-file-0")).toBeVisible();
  await page.getByTestId("diff-file-0-revert").click();
  expect(await cancelledConfirmation).toContain("src/use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);

  await tree.getByTestId("diff-tree-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      resolve(message);
    });
  });
  await page.getByTestId("diff-tree-file-0-revert").click();
  expect(await confirmation).toContain("src/use-mounted-tab-set.ts");

  await expect(tree.getByTestId("diff-tree-file-0")).toHaveCount(0, { timeout: 30_000 });
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
  const workspace = await createWorkspaceWithMountedTabDiff({ includeRenamedFile: true });
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
  const workspace = await createWorkspaceWithMountedTabDiff({ includeUntrackedFile: true });
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

test("Changes keeps review navigation and controls inside its workspace tab", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const visiblePanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(visiblePanel).toBeVisible();
  await expect(visiblePanel.getByTestId("changes-repository-header")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-branch-switcher")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-diff-status-trigger")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-selected-diff-stat")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("changes-header")).toHaveCount(1);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await expect(visiblePanel.getByTestId("changes-primary-cta")).toHaveCount(0);
  await expect(page.getByTestId("changes-primary-cta")).toHaveCount(1);
  await expect(page.getByTestId("changes-primary-cta")).toContainText("Commit");
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).not.toBeVisible();

  await expect(visiblePanel.getByRole("button", { name: "Diff options" })).toHaveCount(0);
  await expect(page.getByTestId("changes-open-tab")).toHaveCount(0);
  const collapseFiles = visiblePanel.getByTestId("changes-toggle-collapse-all");
  await expect(collapseFiles).toHaveAttribute("aria-label", "Collapse all files");
  await collapseFiles.click();
  await expect(collapseFiles).toHaveAttribute("aria-label", "Expand all files");
  await collapseFiles.click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();

  const layout = visiblePanel.getByTestId("changes-toggle-layout");
  await expect(layout).toHaveAttribute("aria-label", "Switch to side-by-side diff");
  await layout.click();
  await expect(layout).toHaveAttribute("aria-label", "Switch to unified diff");

  const whitespace = visiblePanel.getByTestId("changes-toggle-whitespace");
  await expect(whitespace).toHaveAttribute("aria-label", "Hide whitespace");
  const wrapLines = visiblePanel.getByTestId("changes-toggle-wrap-lines");
  await expect(wrapLines).toHaveAttribute("aria-label", "Wrap long lines");
  await expect(visiblePanel.getByTestId("changes-refresh")).toHaveAttribute(
    "aria-label",
    "Refresh",
  );
  await wrapLines.click();
  await expect(wrapLines).toHaveAttribute("aria-label", "Scroll long lines");
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);

  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), BEFORE);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), AFTER);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(visiblePanel.getByText("zz-deleted.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel.getByRole("img", { name: "Deleted" })).toBeVisible();
});

test("Changes marks individual lines and a file as reviewed", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const fileReview = page.getByTestId("diff-file-review-src/use-mounted-tab-set.ts");
  const lineReview = page.getByTestId(/^diff-line-review-/).first();
  const body = page.getByTestId("diff-file-0-body");

  await expect(fileReview).toHaveAttribute("aria-checked", "false");
  await expect(lineReview).toHaveAttribute("aria-checked", "false");
  await lineReview.click();
  await expect(lineReview).toHaveAttribute("aria-checked", "true");
  await expect(fileReview).toHaveAttribute("aria-checked", "mixed");

  await fileReview.click();
  await expect(fileReview).toHaveAttribute("aria-checked", "true");
  await expect(body).not.toBeVisible();

  await fileReview.click();
  await expect(fileReview).toHaveAttribute("aria-checked", "false");
  await expect(body).toBeVisible();
});

test("compact Changes keeps its actions compact and menu-only", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);
  await page.setViewportSize({ width: 480, height: 900 });

  const compactChangesTab = page.getByTestId("explorer-tab-changes").filter({ visible: true });
  if (!(await compactChangesTab.isVisible())) {
    await page.getByTestId("workspace-explorer-toggle").first().click();
  }
  await expect(compactChangesTab).toBeVisible();
  await compactChangesTab.click();
  const compactExplorer = page.getByTestId("explorer-content-area").filter({ visible: true });
  await expect(compactExplorer.getByTestId("changes-header")).toBeVisible();

  const actions = compactExplorer.getByTestId("changes-actions-menu-trigger");
  const options = compactExplorer.getByRole("button", { name: "Diff options" });
  const [actionsBox, optionsBox, glyphBox] = await Promise.all([
    actions.boundingBox(),
    options.boundingBox(),
    options.locator("svg").boundingBox(),
  ]);
  if (!actionsBox || !optionsBox || !glyphBox) {
    throw new Error("Compact Changes toolbar geometry could not be measured");
  }
  expect(actionsBox.width).toBe(48);
  expect(actionsBox.height).toBe(28);
  expect(optionsBox.width).toBe(32);
  expect(optionsBox.height).toBe(32);
  expect(glyphBox.width).toBe(18);
  expect(glyphBox.height).toBe(18);

  await expect(actions).not.toContainText("Commit");
  await expect(actions.locator("svg")).toHaveCount(2);
  await actions.click();
  await expect(page.getByTestId("changes-primary-cta-menu")).toBeVisible();
  await expect(page.getByTestId("changes-menu-commit")).toContainText("Commit");
  await page.keyboard.press("Escape");

  await options.click();
  const wrapLines = page.getByText("Wrap long lines", { exact: true });
  await expect(wrapLines).toBeVisible();
  await wrapLines.click();
  await options.click();
  await expect(
    page.getByTestId("changes-options-menu-content").getByTestId("changes-toggle-wrap-lines"),
  ).toContainText("Scroll long lines");
});

test("canvas diff stays sharp while its workspace pane is resized", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const canvas = page.getByTestId("git-diff-canvas");
  const root = page.getByTestId("git-diff-canvas-root");
  const handle = page
    .getByTestId("workspace-explorer-sidebar-resize-handle")
    .getByRole("separator");
  await expect(handle).toBeVisible();
  await expect
    .poll(async () => {
      const [canvasWidth, rootWidth] = await Promise.all([
        canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
        root.evaluate((element) => element.getBoundingClientRect().width),
      ]);
      return Math.abs(canvasWidth - rootWidth) < 1;
    })
    .toBe(true);
  const [handleBounds, before] = await Promise.all([
    handle.boundingBox(),
    canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        width: canvasElement.getBoundingClientRect().width,
        ratio: window.devicePixelRatio || 1,
      };
    }),
  ]);
  if (!handleBounds) throw new Error("Explorer sidebar resize handle has no bounds");

  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + 120);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + 120, handleBounds.y + 120);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  const duringDrag = await Promise.all([
    canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
    root.evaluate((element) => element.getBoundingClientRect().width),
  ]);
  expect(duringDrag[0]).toBeCloseTo(before.width, 0);
  expect(duringDrag[1]).toBeGreaterThan(before.width + 10);

  await page.mouse.up();
  const resizeFrames = await page.evaluate(async () => {
    const canvasElement = document.querySelector<HTMLCanvasElement>(
      '[data-testid="git-diff-canvas"]',
    )!;
    const ratio = window.devicePixelRatio || 1;
    const frames: Array<{ cssWidth: number; bitmapWidth: number }> = [];
    for (let index = 0; index < 10; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push({
        cssWidth: canvasElement.getBoundingClientRect().width,
        bitmapWidth: canvasElement.width / ratio,
      });
    }
    return frames;
  });
  for (const frame of resizeFrames) {
    expect(Math.abs(frame.cssWidth - frame.bitmapWidth)).toBeLessThan(1);
  }
  await expect
    .poll(async () => {
      const [canvasWidth, rootWidth, backingWidth] = await Promise.all([
        canvas.evaluate((element) => (element as HTMLCanvasElement).getBoundingClientRect().width),
        root.evaluate((element) => element.getBoundingClientRect().width),
        canvas.evaluate((element) => (element as HTMLCanvasElement).width),
      ]);
      return (
        Math.abs(canvasWidth - rootWidth) < 1 &&
        Math.abs(backingWidth / before.ratio - rootWidth) < 1
      );
    })
    .toBe(true);
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
  const before = await readDiffTypographyGeometry(page);

  await changeCodeTypographyFromSettings(page, {
    fontSize: 18,
    fontFamily: "Courier New, Courier, monospace",
  });
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);
  await scrollToLowerUnwrappedDiffRows(page);

  await expectDiffCodeFontSize(page, 18);
  await expectDiffCodeFontFamily(page, "Courier");
  await expectVisibleDiffRowsShareTypography(page);
  const after = await readDiffTypographyGeometry(page);
  expect(after.horizontalExtent).toBeGreaterThan(before.horizontalExtent);
  expect(after.canvasPixels).not.toEqual(before.canvasPixels);
});

test("canvas diff does not commit geometry before configured fonts are ready", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await holdBrowserFontLoads(page);

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
  await openChangesPanel(page);

  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
  await expect(page.getByTestId("diff-file-0-body")).toHaveCount(0);
  await releaseBrowserFontLoads(page);
  await expectExpandedMountedTabDiff(page);
});

test("canvas diff creates, edits, and deletes an inline review without DOM code rows", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await startReviewOnFirstChangedLine(page);
  await cancelInlineReview(page);
  await startReviewOnFirstChangedLine(page);
  await saveInlineReview(page, "Please keep this branch explicit");
  await editInlineReview(page, "Please keep this branch named explicitly");
  await deleteInlineReview(page);

  await expect(page.locator('[data-testid^="diff-code-row-"]')).toHaveCount(0);
});

test("saved suggestions align after the diff gutter", async ({ page }, testInfo) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await startReviewOnFirstChangedLine(page);
  await page.getByRole("tab", { name: "Code change" }).click();
  await page.getByLabel("Suggested replacement").fill("const mountedTabValue = 2;");
  await page.getByRole("button", { name: "Add suggestion" }).click();

  const [body, gutter, rail] = await Promise.all([
    page.getByTestId("diff-file-0-body").boundingBox(),
    page.locator('[data-testid^="diff-review-gutter-"]').first().boundingBox(),
    page.getByTestId("inline-review-content-rail").boundingBox(),
  ]);
  if (!body || !gutter || !rail) throw new Error("Suggestion rail geometry is unavailable");
  expect(rail.x).toBeGreaterThanOrEqual(body.x + gutter.width);
  expect(rail.x + rail.width).toBeLessThanOrEqual(body.x + body.width);
  await page.screenshot({ path: testInfo.outputPath("suggestion-content-rail.png") });
});

test("autofocusing an inline review keeps the Changes tab focused", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const changesTab = page.getByTestId("workspace-tab-working_diff").filter({ visible: true });
  const focusedBackground = await changesTab.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  await startReviewOnFirstChangedLine(page);
  await expect(page.getByTestId("inline-review-editor-input")).toBeFocused();
  await expect
    .poll(() => changesTab.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(focusedBackground);
});

test("split canvas creates a review on the changed side and keeps it in that column", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await configureDiffPresentation(page, { layout: "split", wrapLines: false });
  await openWorkspaceChanges(page, workspace);
  await setOpenChangesPresentation(page, { layout: "split", wrapLines: false });
  await startReviewOnFirstChangedLine(page, "right");
  const [editor, body] = await Promise.all([
    page.getByTestId("inline-review-editor").boundingBox(),
    page.getByTestId("diff-file-0-body").boundingBox(),
  ]);
  expect(editor).not.toBeNull();
  expect(body).not.toBeNull();
  expect(editor!.x).toBeGreaterThanOrEqual(body!.x + body!.width / 2);
  await cancelInlineReview(page);
});

test("scrolling clears the hovered review affordance", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await hoverFirstChangedGutter(page);
  await expect(page.getByRole("button", { name: "Add review comment" })).toBeVisible();
  await page.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop += 80;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });

  await expect(page.getByRole("button", { name: "Add review comment" })).toHaveCount(0);
});

test("canvas diff uses the overlay scrollbar and its thumb controls vertical scrolling", async ({
  page,
}) => {
  const lines = Array.from({ length: 240 }, (_, index) => `export const line${index} = ${index};`);
  const workspace = await createWorkspaceWithExactSelectionDiff(lines.join("\n"));
  await openSelectionWorkspaceChanges(page, workspace);

  const root = page.getByTestId("git-diff-canvas-root");
  const scroller = page.getByTestId("git-diff-scroll");
  const grab = root.getByTestId("workspace-overlay-scrollbar-grab");
  await expect(grab).toBeVisible();
  await expect(scroller).toHaveCSS("scrollbar-width", "none");

  const bounds = await grab.boundingBox();
  if (!bounds) throw new Error("Diff overlay scrollbar thumb has no bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(grab).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 180);
  await page.mouse.up();

  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("the whole reviewable row reveals the gutter affordance and uses a text cursor", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  await page.mouse.move(bodyBounds.x + bodyBounds.width - 32, bodyBounds.y + lineHeight * 1.5);

  const affordance = page.getByRole("button", { name: "Add review comment" });
  await expect(affordance).toBeVisible();
  await expect(affordance.locator("svg")).toBeVisible();
  const affordanceBounds = await affordance.boundingBox();
  expect(affordanceBounds?.width).toBeCloseTo(22, 0);
  expect(affordanceBounds?.height).toBeCloseTo(22, 0);
  await expect(affordance).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("git-diff-scroll")).toHaveCSS("cursor", "text");
});

test("canvas diff copies a dragged character selection without opening a review", async ({
  context,
  page,
}) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await page.keyboard.press("ControlOrMeta+C");

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("CDEFGH");
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
});

test("clicking the canvas dismisses a selection without opening a review", async ({ page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDEFGHIJ");
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragExactAddedText(page, { startOffset: 2, endOffset: 8 });
  await clickFirstChangedLine(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);

  await clickFirstChangedLine(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
});

test("canvas diff replaces a selection with forward and backward drags", async ({
  context,
  page,
}) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("ABCDE\nFGHIJ");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);
  for (const [start, end, expectedText] of [
    [{ line: 0, offset: 2 }, { line: 1, offset: 3 }, "CDE\nFGH"],
    [{ line: 1, offset: 5 }, { line: 0, offset: 3 }, "DE\nFGHIJ"],
  ] as const) {
    await dragAddedTextRange(page, { lines: ["ABCDE", "FGHIJ"], start, end });
    await page.keyboard.press("ControlOrMeta+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedText);
  }
});

test("canvas diff copies only the selected split side", async ({ context, page }) => {
  const lines = ["RIGHT-ONE", "RIGHT-TWO"];
  const workspace = await createWorkspaceWithExactSelectionDiff(lines.join("\n"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await configureDiffPresentation(page, { layout: "split", wrapLines: false });
  await openSelectionWorkspaceChanges(page, workspace);
  await setOpenChangesPresentation(page, { layout: "split", wrapLines: false });
  const before = await readSelectionPaintSamples(page, "right");
  await dragAddedTextRange(page, {
    lines,
    side: "right",
    start: { line: 0, offset: 1 },
    end: { line: 1, offset: 5 },
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("IGHT-ONE\nRIGHT");
  const after = await readSelectionPaintSamples(page, "right");
  expect(after.gutter).toEqual(before.gutter);
  expect(after.opposite).toEqual(before.opposite);
  expect(after.code).not.toEqual(before.code);
});

test("canvas diff copies exact wrapped fragments", async ({ context, page }) => {
  const content = "abcdefghijklmnopqrstuvwxyz".repeat(8);
  const workspace = await createWorkspaceWithExactSelectionDiff(content);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await configureDiffPresentation(page, { layout: "unified", wrapLines: true });
  await openSelectionWorkspaceChanges(page, workspace);
  await setOpenChangesPresentation(page, { layout: "unified", wrapLines: true });
  await dragAddedTextRange(page, {
    lines: [content],
    wrapped: true,
    start: { line: 0, offset: 35 },
    end: { line: 0, offset: 95 },
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(content.slice(35, 95));
});

test("horizontally scrolled selection copies exactly and does not paint the gutter", async ({
  context,
  page,
}) => {
  const content = "0123456789".repeat(50);
  const workspace = await createWorkspaceWithExactSelectionDiff(content);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);
  const horizontalOffset = await horizontallyScrollFirstFile(page, 320);
  const before = await readSelectionPaintSamples(page);
  await dragAddedTextRange(page, {
    lines: [content],
    horizontalOffset,
    start: { line: 0, offset: 48 },
    end: { line: 0, offset: 58 },
  });
  await page.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(content.slice(48, 58));
  const after = await readSelectionPaintSamples(page);
  expect(after.gutter).toEqual(before.gutter);
  expect(after.code).not.toEqual(before.code);
});

test("dragging within one wide grapheme or outside its cell never opens a review", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("👨‍👩‍👧‍👦tail");
  await useCodeFont(page, 40);
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  await dragWithinFirstAddedGrapheme(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);

  await dragFirstAddedLineIntoHeader(page);
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);

  const body = await page.getByTestId("diff-file-0-body").boundingBox();
  if (!body) throw new Error("Expanded diff body has no bounds");
  await page.mouse.click(body.x + 60, body.y + 90, { button: "right" });
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
});

test("collapsing and expanding restores the real horizontal scroll offset", async ({ page }) => {
  const workspace = await createWorkspaceWithExactSelectionDiff("x".repeat(400));
  await useUnwrappedDiffLines(page);
  await openSelectionWorkspaceChanges(page, workspace);

  const retainedOffset = await horizontallyScrollFirstFile(page, 320);
  await page.getByTestId("diff-file-0-toggle").click();
  await expect(page.getByTestId("diff-file-0-horizontal-scroll")).toHaveCount(0);
  await page.getByTestId("diff-file-0-toggle").click();

  await expect
    .poll(() =>
      page.getByTestId("diff-file-0-horizontal-scroll").evaluate((element) => element.scrollLeft),
    )
    .toBe(retainedOffset);
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
  const wideHeaderBounds = await page.getByTestId("diff-file-0-header-content").boundingBox();
  const wideLspBounds = await fileLsp.boundingBox();
  expect(wideHeaderBounds).not.toBeNull();
  expect(wideLspBounds).not.toBeNull();
  expect(wideLspBounds!.y).toBeGreaterThanOrEqual(wideHeaderBounds!.y);
  expect(wideLspBounds!.y + wideLspBounds!.height).toBeLessThanOrEqual(
    wideHeaderBounds!.y + wideHeaderBounds!.height,
  );

  await page.setViewportSize({ width: 560, height: 900 });
  await expect(fileLsp).toHaveText("");
  await expect(fileLsp.locator("svg")).toHaveCount(1);
  await expect(fileLsp).toHaveAccessibleName(/clangd/);
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(fileLsp).toContainText("clangd");

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
          sendBehavior: "interrupt",
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
  await configureDiffPresentation(page, { layout: "unified", wrapLines: false });
}

async function configureDiffPresentation(
  page: Page,
  requestedPresentation: { layout: "unified" | "split"; wrapLines: boolean },
): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey, presentation }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: presentation.layout,
          desktopTreeVisible: false,
          wrapLines: presentation.wrapLines,
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
    { preferencesKey: CHANGES_PREFERENCES_KEY, presentation: requestedPresentation },
  );
}

async function setOpenChangesPresentation(
  page: Page,
  requestedPresentation: { layout: "unified" | "split"; wrapLines: boolean },
): Promise<void> {
  const diffPanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  const layoutItem = diffPanel.getByTestId("changes-toggle-layout");
  const currentLayout =
    (await layoutItem.getAttribute("aria-label")) === "Switch to unified diff"
      ? "split"
      : "unified";
  if (currentLayout !== requestedPresentation.layout) {
    await layoutItem.click();
  }

  const wrapItem = diffPanel.getByTestId("changes-toggle-wrap-lines");
  const currentWrapLines = (await wrapItem.getAttribute("aria-label")) === "Scroll long lines";
  if (currentWrapLines !== requestedPresentation.wrapLines) {
    await wrapItem.click();
  }
}

async function holdBrowserFontLoads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fontSet = document.fonts;
    const originalLoad = fontSet.load.bind(fontSet);
    const pending: Array<() => void> = [];
    Object.defineProperty(fontSet, "load", {
      configurable: true,
      value(font: string, text?: string) {
        return new Promise<FontFace[]>((resolve, reject) => {
          pending.push(() => {
            originalLoad(font, text).then(resolve, reject);
          });
        });
      },
    });
    Object.assign(window, {
      __releasePaseoDiffFontLoads() {
        for (const release of pending.splice(0)) release();
      },
    });
  });
}

async function releaseBrowserFontLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as typeof window & { __releasePaseoDiffFontLoads: () => void }
    ).__releasePaseoDiffFontLoads();
  });
}

async function expectDiffCodeFontSize(page: Page, fontSize: number): Promise<void> {
  const canvas = page.getByTestId("git-diff-canvas");
  await expect
    .poll(async () => {
      return canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
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

async function expectDiffCodeFontFamily(page: Page, fontFamily: string): Promise<void> {
  await expect
    .poll(() =>
      page
        .getByTestId("git-diff-canvas")
        .evaluate((element) => getComputedStyle(element).fontFamily),
    )
    .toContain(fontFamily);
}

async function expectVisibleDiffRowsShareTypography(page: Page): Promise<void> {
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
  await expect(page.locator('[data-testid^="diff-code-row-"]')).toHaveCount(0);
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
    files.push({ path: "src/zz-deleted.ts", content: "export const deleted = true;\n" });
  }
  if (options.includeRenamedFile) {
    files.push({ path: "src/rename-source.ts", content: "export const renamed = true;\n" });
  const stableContext = Array.from(
    { length: options.includeLargeContextGap ? 50 : 0 },
    (_, index) => `const stableContextLine${index + 1} = ${index + 1};`,
  ).join("\n");
  const withStableContext = (source: string) =>
    stableContext
      ? source.replace(
          "export function useMountedTabSet",
          `${stableContext}\n\nexport function useMountedTabSet`,
        )
      : source;
  const before = withStableContext(BEFORE);
  const after = withStableContext(AFTER);
  const files = [{ path: "src/use-mounted-tab-set.ts", content: before }];
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
      { path: "src/zz-folder/nested/changed.ts", content: "export const nested = 1;\n" },
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
  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), after);
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
  return { id: createdWorkspace.workspace.id, repoPath: repo.path };
}

async function createWorkspaceWithCommittedDiff(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-committed-", {
    files: [{ path: "tracked.ts", content: "export const tracked = 1;\n" }],
  });
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

  execFileSync("git", ["checkout", "-b", "feature"], { cwd: repo.path });
  await writeFile(path.join(repo.path, "committed-only.ts"), "export const committed = true;\n");
  execFileSync("git", ["add", "committed-only.ts"], { cwd: repo.path });
  execFileSync("git", ["commit", "-m", "Add committed-only file"], { cwd: repo.path });

  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create committed workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

async function createWorkspaceWithExactSelectionDiff(content: string): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("changes-canvas-selection-", {
    files: [{ path: "src/selection.ts", content: "" }],
  });
  await writeFile(path.join(repo.path, "src/selection.ts"), `${content}\n`);
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create selection workspace");
  return { id: created.workspace.id, repoPath: repo.path };
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
  await page.getByTestId("workspace-explorer-toggle").first().click();
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

async function openWorkspaceChangesSurface(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);
}

async function openSelectionWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page);
  const diffPanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(diffPanel.getByTestId("diff-file-0-name")).toHaveText("selection.ts", {
    timeout: 30_000,
  });
  await expectExpandedMountedTabDiff(page);
}

async function openChangesInVisibleExplorer(page: Page): Promise<void> {
  const explorer = page.getByTestId("workspace-explorer-sidebar");
  await expect(explorer).toBeVisible({ timeout: 30_000 });
  const changesTab = explorer.getByRole("button", { name: /Working tree diff/i }).first();
  await changesTab.click();
  const changedFile = explorer
    .locator('[data-testid^="diff-tree-file-"][data-testid$="-toggle"]')
    .filter({ visible: true })
    .first();
  await expect(changedFile).toBeVisible({ timeout: 30_000 });
  await changedFile.click();
  await expect(page.getByTestId("working-diff-panel").filter({ visible: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible({ timeout: 30_000 });
}

async function changeCodeTypographyFromSettings(
  page: Page,
  typography: { fontSize: number; fontFamily: string },
): Promise<void> {
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(new RegExp(`${buildSettingsSectionRoute("general")}|/settings$`));
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Code font family").fill(typography.fontFamily);
  await page.getByLabel("Code font family").press("Enter");
  await page.getByLabel("Code font size").fill(String(typography.fontSize));
  await page.getByLabel("Code font size").press("Enter");
  await expect(page.getByLabel("Code font family")).toHaveValue(typography.fontFamily);
  await expect(page.getByLabel("Code font size")).toHaveValue(String(typography.fontSize));
  await expectStoredCodeFontSize(page, typography.fontSize);
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

async function startReviewOnFirstChangedLine(
  page: Page,
  side: "unified" | "right" = "unified",
): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  const columnLeft = side === "right" ? bodyBounds.x + bodyBounds.width / 2 : bodyBounds.x;
  await page.mouse.move(columnLeft + 20, bodyBounds.y + lineHeight * 1.5);
  await page.getByRole("button", { name: "Add review comment" }).click();
  await expect(page.getByTestId("inline-review-editor")).toBeVisible();
}

async function clickFirstChangedLine(page: Page): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  await page.mouse.click(bodyBounds.x + 120, bodyBounds.y + lineHeight * 1.5);
}

async function hoverFirstChangedGutter(page: Page): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, fontSize] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(fontSize * 1.5);
  const gutterWidth = 2 * Math.ceil(fontSize * 0.62) + 12;
  await page.mouse.move(bodyBounds.x + gutterWidth, bodyBounds.y + lineHeight * 1.5);
}

async function saveInlineReview(page: Page, body: string): Promise<void> {
  await page.getByTestId("inline-review-editor-input").fill(body);
  await page.getByTestId("inline-review-editor-save").click();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
}

async function cancelInlineReview(page: Page): Promise<void> {
  await page.getByTestId("inline-review-editor-cancel").click();
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
}

async function editInlineReview(page: Page, body: string): Promise<void> {
  await page.getByTestId(/^review-comment-edit-/).click();
  await expect(page.getByTestId("inline-review-editor")).toBeVisible();
  await page.getByTestId("inline-review-editor-input").fill(body);
  await page.getByTestId("inline-review-editor-save").click();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
}

async function deleteInlineReview(page: Page): Promise<void> {
  await page.getByTestId(/^review-comment-delete-/).click();
  await expect(page.getByTestId(/^review-comment-delete-/)).toHaveCount(0);
}

async function dragExactAddedText(
  page: Page,
  offsets: { startOffset: number; endOffset: number },
): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bodyBounds, metrics] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const measurementCanvas = document.createElement("canvas");
      const context = measurementCanvas.getContext("2d")!;
      context.font = `${fontSize}px ${style.fontFamily}`;
      return { fontSize, characterWidth: context.measureText("A").width };
    }),
  ]);
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const gutter = await firstReviewGutterBounds(page, bodyBounds);
  const textLeft = gutter.x + gutter.width + 8;
  await page.mouse.move(
    textLeft + offsets.startOffset * metrics.characterWidth + 1,
    gutter.y + gutter.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    textLeft + offsets.endOffset * metrics.characterWidth - 1,
    gutter.y + gutter.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
}

async function dragAddedTextRange(
  page: Page,
  input: {
    lines: string[];
    start: { line: number; offset: number };
    end: { line: number; offset: number };
    side?: "left" | "right";
    wrapped?: boolean;
    horizontalOffset?: number;
  },
): Promise<void> {
  const body = page.getByTestId("diff-file-0-body");
  const canvas = page.getByTestId("git-diff-canvas");
  const [bounds, metrics] = await Promise.all([
    body.boundingBox(),
    canvas.evaluate((element) => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${fontSize}px ${style.fontFamily}`;
      return { fontSize, characterWidth: context.measureText("A").width };
    }),
  ]);
  if (!bounds) throw new Error("Expanded diff body has no bounds");
  const lineHeight = Math.round(metrics.fontSize * 1.5);
  const gutter = await firstReviewGutterBounds(
    page,
    bounds,
    input.side === "right" ? "right" : "unified",
  );
  const columnWidth = input.side ? bounds.width / 2 : bounds.width;
  const availableWidth = columnWidth - gutter.width - 16;
  const charactersPerFragment = Math.max(1, Math.floor(availableWidth / metrics.characterWidth));
  const fragmentsBefore = (line: number) =>
    input.wrapped
      ? input.lines
          .slice(0, line)
          .reduce(
            (total, text) => total + Math.max(1, Math.ceil(text.length / charactersPerFragment)),
            0,
          )
      : line;
  const point = ({ line, offset }: { line: number; offset: number }) => {
    const fragment = input.wrapped ? Math.floor(offset / charactersPerFragment) : 0;
    const localOffset = input.wrapped ? offset % charactersPerFragment : offset;
    return {
      x:
        gutter.x +
        gutter.width +
        8 +
        localOffset * metrics.characterWidth -
        (input.horizontalOffset ?? 0),
      y: gutter.y + gutter.height / 2 + (fragmentsBefore(line) + fragment) * lineHeight,
    };
  };
  const start = point(input.start);
  const end = point(input.end);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function readSelectionPaintSamples(
  page: Page,
  side: "unified" | "right" = "unified",
): Promise<{ gutter: number[]; code: number[]; opposite: number[] }> {
  return page.getByTestId("diff-file-0-body").evaluate((body, selectedSide) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="git-diff-canvas"]')!;
    const bodyBounds = body.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / canvasBounds.width;
    const scaleY = canvas.height / canvasBounds.height;
    const context = canvas.getContext("2d")!;
    const sample = (left: number, top: number, width: number, height: number) =>
      Array.from(
        context.getImageData(
          Math.round((left - canvasBounds.left) * scaleX),
          Math.round((top - canvasBounds.top) * scaleY),
          Math.max(1, Math.round(width * scaleX)),
          Math.max(1, Math.round(height * scaleY)),
        ).data,
      );
    const columnLeft =
      selectedSide === "right" ? bodyBounds.left + bodyBounds.width / 2 : bodyBounds.left;
    return {
      gutter: sample(columnLeft + 2, bodyBounds.top + 24, 8, 8),
      code: sample(columnLeft + 80, bodyBounds.top + 24, 80, 10),
      opposite: sample(bodyBounds.left + 80, bodyBounds.top + 24, 80, 10),
    };
  }, side);
}

async function dragWithinFirstAddedGrapheme(page: Page): Promise<void> {
  const bodyBounds = await page.getByTestId("diff-file-0-body").boundingBox();
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const gutter = await firstReviewGutterBounds(page, bodyBounds);
  const x = gutter.x + gutter.width + 10;
  const y = gutter.y + gutter.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 5, y, { steps: 3 });
  await page.mouse.up();
}

async function dragFirstAddedLineIntoHeader(page: Page): Promise<void> {
  const bodyBounds = await page.getByTestId("diff-file-0-body").boundingBox();
  if (!bodyBounds) throw new Error("Expanded diff body has no bounds");
  const gutter = await firstReviewGutterBounds(page, bodyBounds);
  const x = bodyBounds.x + 60;
  await page.mouse.move(x, gutter.y + gutter.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, bodyBounds.y - 10, { steps: 4 });
  await page.mouse.up();
}

async function horizontallyScrollFirstFile(page: Page, requestedOffset: number): Promise<number> {
  const horizontalScroll = page.getByTestId("diff-file-0-horizontal-scroll");
  const retainedOffset = await horizontalScroll.evaluate((element, offset) => {
    element.scrollLeft = offset;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollLeft;
  }, requestedOffset);
  expect(retainedOffset).toBeGreaterThan(0);
  return retainedOffset;
}

async function longPressFileHeader(page: Page, header: Locator): Promise<void> {
  const bounds = await header.boundingBox();
  if (!bounds) throw new Error("File header has no bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

async function readDiffTypographyGeometry(page: Page): Promise<{
  horizontalExtent: number;
  canvasPixels: string;
}> {
  const horizontalExtent = await page
    .getByTestId("diff-file-0-horizontal-scroll")
    .evaluate((element) => element.scrollWidth);
  const canvasPixels = (await page.getByTestId("git-diff-canvas").screenshot()).toString("base64");
  return { horizontalExtent, canvasPixels };
}

async function returnToWorkspaceChanges(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-workspace").click();
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

async function scrollToLowerUnwrappedDiffRows(page: Page): Promise<void> {
  await page.getByTestId("git-diff-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
}
