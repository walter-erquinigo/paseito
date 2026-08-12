import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildHostWorkspaceRoute } from "../src/utils/host-routes";
import { expect, test, type Page } from "./fixtures";
import { expectFileTabOpen, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import { getServerId } from "./helpers/server-id";
import { connectSeedClient } from "./helpers/seed-client";
import { createTempDirectory, createTempGitRepo } from "./helpers/workspace";
import { waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";

function sourceEditor(page: Page) {
  return page.getByTestId("file-source-editor").filter({ visible: true });
}

async function expectEditorLeftOfPreview(page: Page, previewText: string): Promise<void> {
  const editorBounds = await sourceEditor(page).boundingBox();
  const previewBounds = await page.getByText(previewText, { exact: true }).boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(previewBounds).not.toBeNull();
  expect(editorBounds!.x + editorBounds!.width).toBeLessThanOrEqual(previewBounds!.x);
}

test("Markdown preview file locations open in a reusable left source pane", async ({
  page,
  withWorkspace,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspace = await withWorkspace({ prefix: "markdown-file-links-" });
  const outside = await createTempDirectory("markdown-file-links-outside-");
  const outsidePath = path.join(outside.path, "outside.ts");
  const spacedPath = path.join(workspace.repoPath, "spaced file.ts");
  const relativeTarget = "relative.ts:3:4";
  const absoluteTarget = `${outsidePath}:2:5`;
  const missingTarget = "missing.ts:9:2";

  try {
    await writeFile(
      path.join(workspace.repoPath, "relative.ts"),
      ["first", "second", "abcdefghij", "fourth"].join("\n"),
      "utf8",
    );
    await writeFile(outsidePath, ["outside first", "outside target", "outside third"].join("\n"));
    await writeFile(spacedPath, ["spaced first", "spaced target"].join("\n"));
    await writeFile(
      path.join(workspace.repoPath, "notes.md"),
      [
        "# Locations",
        "",
        `Inline \`${relativeTarget}\`.`,
        `Absolute ${absoluteTarget}.`,
        `Missing ${missingTarget}.`,
        "Explicit [source](relative.ts#L4C3) and [spaced](<spaced file.ts:2:3>).",
        "External https://example.com/source.ts:10-4 remains external.",
        "Ordinary README.md prose stays plain.",
        "",
        "```text",
        "fenced.ts:4-2",
        "```",
      ].join("\n"),
      "utf8",
    );

    await workspace.navigateTo();
    await openFileExplorer(page);
    await openFileFromExplorer(page, "notes.md");
    await expectFileTabOpen(page, "notes.md");

    const relativeLink = page.getByText(relativeTarget, { exact: true });
    await expect(relativeLink).toBeVisible();
    await relativeLink.click();

    await expectFileTabOpen(page, path.join(workspace.repoPath, "relative.ts"));
    await expect(sourceEditor(page)).toBeVisible();
    await expect(page.getByLabel("Line 3, column 4")).toBeVisible();
    await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);
    await expect(relativeLink).toBeVisible();
    await expectEditorLeftOfPreview(page, relativeTarget);
    await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(0);

    const absoluteLink = page.getByText(absoluteTarget, { exact: true });
    await absoluteLink.click();
    await expectFileTabOpen(page, outsidePath);
    await expect(page.getByLabel("Line 2, column 5")).toBeVisible();
    await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);
    await expectEditorLeftOfPreview(page, absoluteTarget);

    await page.getByText(missingTarget, { exact: true }).click();
    await expect(page.getByTestId("assistant-file-link-not-found-toast")).toContainText(
      missingTarget,
    );
    await expect(page.getByText("Locations", { exact: true })).toBeVisible();
    await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);

    await expect(page.locator('a[href="relative.ts#L4C3"]')).toBeVisible();
    const spacedLink = page.locator('a[href="spaced%20file.ts:2:3"]');
    await spacedLink.click();
    await expectFileTabOpen(page, spacedPath);
    await expect(page.getByLabel("Line 2, column 3")).toBeVisible();
    await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);
    await expectEditorLeftOfPreview(page, "Locations");

    await expect(page.locator('a[href="https://example.com/source.ts:10-4"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "README.md" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "fenced.ts:4-2" })).toHaveCount(0);
  } finally {
    await outside.cleanup();
  }
});

test("Markdown preview locations reuse an existing Changes tab when its current line is available", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  const originalLines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
  const repo = await createTempGitRepo("markdown-changes-links-", {
    files: [
      { path: "long.ts", content: `${originalLines.join("\n")}\n` },
      { path: "unchanged.ts", content: "unchanged first\nunchanged second\n" },
      {
        path: "notes.md",
        content: [
          "# Changes navigation",
          "",
          "[column](long.ts#L40C180)",
          "[range](long.ts#L39-L41)",
          "[hidden](long.ts#L20)",
          "[unchanged](unchanged.ts#L2)",
        ].join("\n"),
      },
    ],
  });
  const changedLines = [...originalLines];
  changedLines[39] = `changed ${"x".repeat(260)}`;
  for (const lineNumber of [80, 120, 160, 190]) {
    changedLines[lineNumber - 1] = `changed line ${lineNumber}`;
  }
  await writeFile(path.join(repo.path, "long.ts"), `${changedLines.join("\n")}\n`);
  const client = await connectSeedClient();

  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    expect(created.workspace).not.toBeNull();
    await page.goto(buildHostWorkspaceRoute(getServerId(), created.workspace!.id));
    await waitForWorkspaceTabsVisible(page);
    await page.getByRole("button", { name: "Open explorer" }).click();
    await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("long.ts", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("changes-open-tab").click();

    const panel = page.getByTestId("working-diff-panel").filter({ visible: true });
    await expect(panel).toBeVisible();
    await panel.getByTestId("diff-file-0-toggle").click();
    await expect(panel.getByTestId("diff-file-0-body")).toHaveCount(0);

    await page.getByTestId("explorer-tab-files").click();
    await expect(page.getByTestId("file-explorer-tree-scroll")).toBeVisible({ timeout: 30_000 });
    await openFileFromExplorer(page, "notes.md");
    const notesTab = page.getByTestId("workspace-tab-file_notes.md").filter({ visible: true });
    await expect(notesTab).toBeVisible();

    await page.locator('a[href="long.ts#L40C180"]').click();
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("diff-file-0-body")).toBeVisible();
    const selectedColumnLine = panel.locator(
      '[data-paseito-diff-current-line="40"][data-paseito-diff-navigation-selected="true"]',
    );
    await expect(selectedColumnLine).toBeVisible();
    await expect(panel.getByTestId("git-diff-scroll")).toBeFocused();
    await expect
      .poll(() =>
        selectedColumnLine.evaluate((element) => {
          let parent = element.parentElement;
          while (parent) {
            if (parent.scrollWidth > parent.clientWidth + 1) return parent.scrollLeft;
            parent = parent.parentElement;
          }
          return 0;
        }),
      )
      .toBeGreaterThan(0);

    await notesTab.click();
    await page.locator('a[href="long.ts#L39-L41"]').click();
    await expect(panel.locator('[data-paseito-diff-navigation-selected="true"]')).toHaveCount(3);

    await panel.getByTestId("working-diff-toggle-layout").click();
    await notesTab.click();
    await page.locator('a[href="long.ts#L20"]').click();
    const hiddenLine = panel.locator(
      '[data-paseito-diff-current-line="20"][data-paseito-diff-navigation-selected="true"]',
    );
    await expect(hiddenLine).toBeVisible({ timeout: 30_000 });
    const diffScroll = panel.getByTestId("git-diff-scroll");
    await diffScroll.evaluate((element) => {
      element.scrollTop = Math.min(200, element.scrollHeight - element.clientHeight);
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(hiddenLine).toHaveAttribute("data-paseito-diff-navigation-selected", "true");

    await notesTab.click();
    await page.locator('a[href="long.ts#L20"]').click();
    await expect(diffScroll).toBeFocused();
    await expectLineNearDiffTop(hiddenLine, diffScroll);

    await notesTab.click();
    await page.locator('a[href="unchanged.ts#L2"]').click();
    await expectFileTabOpen(page, path.join(repo.path, "unchanged.ts"));
    await expect(sourceEditor(page)).toBeVisible();
    await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);
    await expect(page.getByText("Changes navigation", { exact: true })).toBeVisible();
  } finally {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  }
});

async function expectLineNearDiffTop(
  line: ReturnType<Page["locator"]>,
  scroll: ReturnType<Page["getByTestId"]>,
): Promise<void> {
  await expect
    .poll(async () => {
      const [lineBounds, scrollBounds] = await Promise.all([
        line.boundingBox(),
        scroll.boundingBox(),
      ]);
      if (!lineBounds || !scrollBounds) return null;
      return lineBounds.y - scrollBounds.y;
    })
    .toBeLessThanOrEqual(100);
}
