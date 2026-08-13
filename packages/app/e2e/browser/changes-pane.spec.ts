import { execFileSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildSettingsSectionRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

interface DirtyWorkspace {
  id: string;
  repoPath: string;
  editedLineCount: number;
}

interface WorkspaceFixtureOptions {
  includeDeletedFile?: boolean;
}

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@paseo:app-settings";
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
  await expect(page.getByTestId("diff-file-0")).toContainText(`0/${workspace.editedLineCount}`);

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
  await expect(page.getByTestId("diff-file-0")).toContainText(`0/${workspace.editedLineCount}`);
  await page.setViewportSize({ width: 1400, height: 900 });

  const unifiedCheckbox = page
    .locator('[data-testid^="diff-gutter-cell-"]')
    .getByRole("checkbox")
    .first();
  await expectCheckboxFixedWhileCodeScrolls(page, "diff-file-0-body", unifiedCheckbox);

  await page.getByTestId("changes-options-menu").click();
  await page.getByTestId("changes-toggle-wrap-lines").click();
  await expectLineReviewControls(page, workspace.editedLineCount);
  const blankReviewRowCount = await page
    .getByTestId(/^diff-wrapped-row-/)
    .evaluateAll((rows) => rows.filter((row) => !row.querySelector('[role="checkbox"]')).length);
  expect(blankReviewRowCount).toBeGreaterThan(0);

  await page.getByTestId("changes-options-menu").click();
  await page.getByTestId("changes-toggle-wrap-lines").click();
  await page.getByTestId("changes-toggle-layout").click();
  await expectLineReviewControls(page, workspace.editedLineCount);
  const leftCheckbox = page
    .locator('[data-testid^="diff-left-gutter-cell-"]')
    .getByRole("checkbox")
    .first();
  const rightCheckbox = page
    .locator('[data-testid^="diff-right-gutter-cell-"]')
    .getByRole("checkbox")
    .first();
  await expectCheckboxFixedWhileCodeScrolls(page, "diff-left-column", leftCheckbox);
  await expectCheckboxFixedWhileCodeScrolls(page, "diff-right-column", rightCheckbox);
});

test("changes file actions open from the kebab and right-click", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expect(page.getByTestId("diff-file-1")).toContainText("zz-deleted.ts");
  await expect(page.getByTestId(/diff-file-\d+-actions/)).toHaveCount(0);
  await page.getByTestId("diff-file-1-toggle").click({ button: "right" });
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
  expect(menuBounds!.x).toBeCloseTo(fileRowBounds!.x + 80, 0);
  expect(menuBounds!.y).toBeGreaterThan(fileRowBounds!.y + 10);
  await page.getByTestId("diff-file-0-open-file").click();

  await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-file_src/use-mounted-tab-set.ts")).toBeVisible();
});

test("Changes switches between inline and full-tab navigation", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const changesTabToggle = page.getByTestId("changes-open-tab");
  await expect(changesTabToggle).toHaveAccessibleName("Open Changes tab");
  await changesTabToggle.click();
  await expect(changesTabToggle).toHaveAccessibleName("Close Changes tab");

  const visiblePanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(visiblePanel).toBeVisible();
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  await expect(page.getByTestId("workspace-file-pane")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  const workingDiffLayoutToggle = visiblePanel.getByTestId("working-diff-toggle-layout");
  await expect(workingDiffLayoutToggle).toHaveAccessibleName("Switch to side-by-side diff");
  await workingDiffLayoutToggle.click();
  await expect(workingDiffLayoutToggle).toHaveAccessibleName("Switch to unified diff");
  await visiblePanel.getByTestId("working-diff-options-menu").click();
  await expect(page.getByTestId("working-diff-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("working-diff-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("working-diff-refresh")).toContainText("Refresh");
  await page.getByTestId("working-diff-toggle-wrap-lines").click();
  await visiblePanel.getByTestId("working-diff-options-menu").click();
  await expect(page.getByTestId("working-diff-toggle-wrap-lines")).toContainText(
    "Scroll long lines",
  );
  await page.keyboard.press("Escape");
  await visiblePanel.getByTestId("working-diff-toggle-expand-all").click();
  await expect(visiblePanel.getByTestId(/^diff-file-\d+-body$/)).toHaveCount(0);
  await visiblePanel.getByTestId("working-diff-toggle-expand-all").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();

  const expandUnreviewedFiles = visiblePanel.getByTestId("working-diff-expand-unreviewed-files");
  await expect(expandUnreviewedFiles).toHaveAccessibleName(
    "Expand unreviewed files and collapse reviewed files",
  );
  await visiblePanel.getByTestId("diff-file-0-reviewed").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-1-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-1-body")).toHaveCount(0);
  await expandUnreviewedFiles.click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toHaveCount(0);
  await expect(visiblePanel.getByTestId("diff-file-1-body")).toBeVisible();

  await page.getByTestId("explorer-content-area").getByTestId("diff-file-0-toggle").click();
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toHaveCount(0);
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

  await expect(page.getByTestId("explorer-content-area").getByTestId("diff-file-1")).toContainText(
    "zz-deleted.ts",
  );
  await page.getByTestId("explorer-content-area").getByTestId("diff-file-1-toggle").click();
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);
  await expect(visiblePanel.getByText("zz-deleted.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel.getByRole("img", { name: "Deleted" })).toBeVisible();

  await changesTabToggle.click();
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(0);
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toBeVisible();
  await page.getByTestId("explorer-content-area").getByTestId("diff-file-0-toggle").click();
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toHaveCount(0);
});

test("changes diff switches between flat and tree file lists", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectFlatFileList(page);
  await expect(page.getByTestId("changes-toggle-layout")).toBeVisible();
  await expect(page.getByTestId("changes-layout-unified")).toHaveCount(0);
  await expect(page.getByTestId("changes-layout-split")).toHaveCount(0);

  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-options-menu-content")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("changes-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("changes-refresh")).toContainText("Refresh");
  await page.getByTestId("changes-toggle-whitespace").click();
  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Show whitespace");
  await page.keyboard.press("Escape");

  await scrollToLowerUnwrappedDiffRows(page);
  await page.getByTestId("changes-toggle-view-mode").click();
  await expect(page.getByTestId("diff-folder-src")).toBeVisible();
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await expect(page.getByTestId("diff-file-0-context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible();

  await page.getByTestId("diff-folder-src-toggle").click();
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);

  await page.getByTestId("changes-toggle-view-mode").click();
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
  await scrollToLowerUnwrappedDiffRows(page);

  await expectDiffCodeFontSize(page, 18);
  await expectVisibleDiffRowsShareTypography(page);
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
  await expect(page.getByTestId("diff-file-0")).toContainText(`0/${editedLineCount}`);
}

async function getReviewTargetKey(checkbox: Locator): Promise<string> {
  const testID = await checkbox.getAttribute("data-testid");
  if (!testID?.startsWith("diff-line-review-")) {
    throw new Error("Line review checkbox has no target key");
  }
  return testID.slice("diff-line-review-".length);
}

async function expectCheckboxFixedWhileCodeScrolls(
  page: Page,
  scrollContainerTestID: string,
  checkbox: Locator,
): Promise<void> {
  await expect(checkbox).toBeVisible();
  const before = await checkbox.boundingBox();
  expect(before).not.toBeNull();
  const overflow = await page.getByTestId(scrollContainerTestID).evaluate((container) => {
    const candidates = [container, ...container.querySelectorAll<HTMLElement>("*")];
    const scroll = candidates.find((element) => {
      const style = getComputedStyle(element);
      return (
        element.scrollWidth > element.clientWidth &&
        (style.overflowX === "auto" || style.overflowX === "scroll")
      );
    });
    if (!scroll) throw new Error("Could not find the horizontal diff scroller");
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
        .getByTestId("diff-code-text-1")
        .evaluate((text) => Number.parseFloat(getComputedStyle(text).fontSize));
    })
    .toBe(fontSize);
}

async function expectVisibleDiffRowsShareTypography(page: Page): Promise<void> {
  const geometry = await readVisibleDiffRowGeometry(page);
  expect(geometry.mismatchedTypography, JSON.stringify(geometry, null, 2)).toEqual([]);
}

async function readVisibleDiffRowGeometry(page: Page): Promise<{
  mismatchedTypography: { index: number; gutterLineHeight: number; codeLineHeight: number }[];
  rows: {
    index: number;
    gutterTop: number;
    codeTop: number;
    gutterLineHeight: number;
    codeLineHeight: number;
  }[];
}> {
  return page.locator("body").evaluate(({ ownerDocument }) => {
    const root = ownerDocument.querySelector('[data-testid="diff-file-0-body"]');
    if (!root) {
      throw new Error("Expanded diff body is not mounted");
    }

    const readRows = (prefix: string, textPrefix: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`))
        .map((row) => {
          const testId = row.getAttribute("data-testid") ?? "";
          const index = Number(testId.slice(prefix.length));
          const rect = row.getBoundingClientRect();
          const text = root.querySelector<HTMLElement>(`[data-testid="${textPrefix}${index}"]`);
          if (!text) {
            return null;
          }
          const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
          return { index, top: rect.top, height: rect.height, lineHeight };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

    const gutters = new Map(
      readRows("diff-gutter-row-", "diff-gutter-text-").map((row) => [row.index, row]),
    );
    const codes = readRows("diff-code-row-", "diff-code-text-");
    const rows = codes
      .map((code) => {
        const gutter = gutters.get(code.index);
        if (!gutter) {
          throw new Error(`Missing gutter row ${code.index}`);
        }
        return {
          index: code.index,
          gutterTop: gutter.top,
          codeTop: code.top,
          gutterLineHeight: gutter.lineHeight,
          codeLineHeight: code.lineHeight,
        };
      })
      .filter((row) => row.gutterTop >= 0 && row.codeTop >= 0);

    return {
      mismatchedTypography: rows
        .filter(
          (row) =>
            row.codeLineHeight > 0 && Math.abs(row.gutterLineHeight - row.codeLineHeight) > 0.5,
        )
        .map((row) => ({
          index: row.index,
          gutterLineHeight: row.gutterLineHeight,
          codeLineHeight: row.codeLineHeight,
        })),
      rows,
    };
  });
}

async function createWorkspaceWithMountedTabDiff(
  options: WorkspaceFixtureOptions = {},
): Promise<DirtyWorkspace> {
  const files = [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }];
  if (options.includeDeletedFile) {
    files.push({ path: "src/zz-deleted.ts", content: "export const deleted = true;\n" });
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
  const [additions, deletions] = execFileSync(
    "git",
    ["diff", "--numstat", "--", "src/use-mounted-tab-set.ts"],
    { cwd: repo.path },
  )
    .toString()
    .trim()
    .split(/\s+/)
    .map(Number);
  const editedLineCount = additions + deletions;
  if (options.includeDeletedFile) {
    await unlink(path.join(repo.path, "src/zz-deleted.ts"));
  }
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path, editedLineCount };
}

async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await page.getByRole("button", { name: "Open explorer" }).click();
  await openChangesInVisibleExplorer(page);
  await page.getByTestId("diff-file-0").click();
  await expectExpandedMountedTabDiff(page);
}

async function openChangesInVisibleExplorer(page: Page): Promise<void> {
  await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("use-mounted-tab-set.ts")).toBeVisible({ timeout: 30_000 });
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("function createInitialMountedTabIds")).toBeVisible({
    timeout: 30_000,
  });
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

async function scrollToLowerUnwrappedDiffRows(page: Page): Promise<void> {
  const lastRowIndex = await page.getByTestId("diff-file-0-body").evaluate((root) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="diff-code-row-"]'));
    if (rows.length === 0) {
      throw new Error("No unwrapped code rows are mounted");
    }
    return Math.max(
      ...rows.map((row) => Number((row.getAttribute("data-testid") ?? "").slice(14))),
    );
  });
  await page.getByTestId(`diff-code-row-${lastRowIndex}`).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(`diff-code-row-${lastRowIndex}`)).toBeVisible();
}
