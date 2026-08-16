import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

interface NavigatorWorkspace {
  id: string;
  close: () => Promise<void>;
}

const CHANGES_PREFERENCES_KEY = "@paseo:changes-preferences";
const TARGET_FILE_INDEX = 19;
const TARGET_PATH = "src/zeta/file-19.ts";

test("full Changes tab navigates files from a responsive persistent right rail", async ({
  page,
}) => {
  const workspace = await createNavigatorWorkspace();
  try {
    await page.addInitScript(
      (storageKey) => localStorage.removeItem(storageKey),
      CHANGES_PREFERENCES_KEY,
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        "panel-state",
        JSON.stringify({ state: { explorerWidth: 1100 }, version: 12 }),
      );
    });
    await openInlineChanges(page, workspace.id);

    const explorer = page.getByTestId("explorer-content-area");
    await expect(page.getByTestId("changes-toggle-view-mode")).toBeVisible();
    await expect
      .poll(async () => (await explorer.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(800);
    await expect(explorer.getByTestId("changes-file-tree-navigator")).toBeVisible();
    await page.getByTestId("changes-open-tab").click();

    const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
    const navigator = panel.getByTestId("changes-file-tree-navigator");
    const diffScroll = panel.getByTestId("git-diff-scroll");
    await expect(navigator).toBeVisible();
    const [diffBounds, navigatorBounds] = await Promise.all([
      diffScroll.boundingBox(),
      navigator.boundingBox(),
    ]);
    expect(diffBounds).not.toBeNull();
    expect(navigatorBounds).not.toBeNull();
    expect(navigatorBounds!.x).toBeGreaterThanOrEqual(diffBounds!.x + diffBounds!.width - 1);

    await panel.getByTestId("working-diff-toggle-expand-all").click();
    await expect(panel.getByTestId(/^diff-file-\d+-body$/)).toHaveCount(0);

    const targetRow = panel.getByTestId(`changes-file-tree-file-${TARGET_PATH}-activate`);
    await targetRow.click();
    await expect(panel.getByTestId(`diff-file-${TARGET_FILE_INDEX}-body`)).toBeVisible();
    await expect(targetRow).toHaveAttribute("aria-selected", "true");
    await expect(diffScroll).toBeFocused();
    await expectHeaderAlignedToTop(panel, TARGET_FILE_INDEX);

    await diffScroll.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(targetRow).toHaveAttribute("aria-selected", "true");
    await targetRow.click();
    await expect(diffScroll).toBeFocused();
    await expectHeaderAlignedToTop(panel, TARGET_FILE_INDEX);

    await panel.getByTestId("changes-file-tree-collapse").click();
    await expect(navigator).toHaveCount(0);
    await expectStoredNavigatorPreference(page, true);
    await page.getByTestId("changes-open-tab").click();
    await page.getByTestId("changes-open-tab").click();
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("changes-file-tree-navigator")).toHaveCount(0);
    const navigatorToggle = panel.getByTestId("working-diff-toggle-file-tree");
    await expect(navigatorToggle).toHaveAccessibleName("Show file navigator");
    await navigatorToggle.click();
    await expect(panel.getByTestId("changes-file-tree-navigator")).toBeVisible();
    await expectStoredNavigatorPreference(page, false);

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(panel.getByTestId("changes-file-tree-navigator")).toHaveCount(0);
    await expectStoredNavigatorPreference(page, false);
    await page.setViewportSize({ width: 2600, height: 900 });
    await expect(panel.getByTestId("changes-file-tree-navigator")).toBeVisible();

    await page.getByTestId("changes-open-tab").click();
    await expect(explorer.getByTestId("changes-file-tree-navigator")).toBeVisible();
    await expect(
      page.getByTestId("explorer-content-area").getByTestId("changes-toggle-view-mode"),
    ).toBeVisible();
  } finally {
    await workspace.close();
  }
});

async function createNavigatorWorkspace(): Promise<NavigatorWorkspace> {
  const files = Array.from({ length: TARGET_FILE_INDEX + 1 }, (_, index) => {
    let directory = "beta";
    if (index === TARGET_FILE_INDEX) {
      directory = "zeta";
    } else if (index % 2 === 0) {
      directory = "alpha";
    }
    return {
      path: `src/${directory}/file-${String(index).padStart(2, "0")}.ts`,
      content: `export const value${index} = 0;\n`,
    };
  });
  const repo = await createTempGitRepo("changes-file-tree-navigator-", { files });
  await Promise.all(
    files.map((file, index) =>
      writeFile(
        path.join(repo.path, file.path),
        [`export const value${index} = 1;`, `export const changed${index} = true;`, ""].join("\n"),
      ),
    ),
  );
  const client = await connectSeedClient();
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
    throw new Error(created.error ?? "Failed to create navigator workspace");
  }
  return {
    id: created.workspace.id,
    close: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  };
}

async function openInlineChanges(page: Page, workspaceId: string): Promise<void> {
  await page.setViewportSize({ width: 2600, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
  await waitForWorkspaceTabsVisible(page);
  await page.getByRole("button", { name: "Open explorer" }).click();
  await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByTestId("explorer-content-area")
      .getByTestId("diff-file-0-toggle")
      .getByText("file-00.ts", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

async function expectHeaderAlignedToTop(panel: ReturnType<Page["getByTestId"]>, index: number) {
  await expect
    .poll(async () => {
      const [header, scroll] = await Promise.all([
        panel.getByTestId(`diff-file-${index}`).boundingBox(),
        panel.getByTestId("git-diff-scroll").boundingBox(),
      ]);
      if (!header || !scroll) {
        return null;
      }
      return Math.abs(header.y - scroll.y);
    })
    .toBeLessThanOrEqual(2);
}

async function expectStoredNavigatorPreference(page: Page, expected: boolean): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        CHANGES_PREFERENCES_KEY,
      );
      if (!raw) {
        return null;
      }
      return (JSON.parse(raw) as { fileTreeCollapsed?: boolean }).fileTreeCollapsed ?? null;
    })
    .toBe(expected);
}
