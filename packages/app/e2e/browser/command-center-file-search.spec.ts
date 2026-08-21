import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { openCommandCenter } from "../support/helpers/command-center";
import {
  delayDirectorySuggestionResponses,
  expectOneLineTruncatedFileResult,
  expectStableCommandCenterLayout,
  failDirectorySuggestionRequests,
  hideAbsoluteFileSearchCapability,
  hideWorkspaceFileSearchCapability,
  startCommandCenterLayoutObservation,
} from "../support/helpers/command-center-file-search";
import { expectFileTabOpen } from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

const FILE_PATH =
  "packages/app/src/command-center/features/workspace-file-search/layout-stability/needle-layout-stability-command-center.tsx";
const FILE_NAME = "needle-layout-stability-command-center.tsx";
const FILE_DIRECTORY =
  "packages/app/src/command-center/features/workspace-file-search/layout-stability";

function paseoSizedFiles(): Array<{ path: string; content: string }> {
  const files = Array.from({ length: 120 }, (_, index) => ({
    path: `packages/app/src/features/feature-${String(index).padStart(3, "0")}/index.ts`,
    content: `export const feature${index} = ${index};\n`,
  }));
  files.push({ path: FILE_PATH, content: "export const layoutNeedle = true;\n" });
  return files;
}

async function seedMatchingWorkspaces(count: number): Promise<SeededWorkspace[]> {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      seedWorkspace({
        repoPrefix: `command-center-file-search-error-${String(index).padStart(2, "0")}-`,
        title: `Home failure ${String(index).padStart(2, "0")}`,
      }),
    ),
  );
}

test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0 Safari/537.36",
});

test("workspace file search stays geometrically stable through delayed loading and results", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-file-search-",
    title: "Paseo-shaped file search",
    repo: { files: paseoSizedFiles() },
  });

  try {
    await delayDirectorySuggestionResponses(page, 800);
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole("button", { name: "Files" })).toBeVisible();
    await startCommandCenterLayoutObservation(page);

    await panel.getByTestId("command-center-input").fill(FILE_NAME);
    const row = panel.getByRole("button", {
      name: `${FILE_NAME} ${FILE_DIRECTORY}`,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expectOneLineTruncatedFileResult(row, {
      filename: FILE_NAME,
      path: FILE_DIRECTORY,
    });

    await panel.getByTestId("command-center-input").fill("needle-layout");
    await page.waitForTimeout(150);
    expect(await row.isVisible()).toBe(true);
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeVisible();
    await expect(panel.getByText("Searching files...", { exact: true })).toHaveCount(0);
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeHidden();
    await expectStableCommandCenterLayout(page);

    await row.click();
    await expectFileTabOpen(page, FILE_PATH);
  } finally {
    await seeded.cleanup();
  }
});

test("dropping the files scope leaves the search row the same height", async ({ page }) => {
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-file-search-scope-",
    title: "Scope chip height",
  });

  try {
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const header = panel.getByTestId("command-center-header");
    const scoped = await header.boundingBox();

    await page.getByTestId("command-center-files-scope").click();
    await expect(page.getByTestId("command-center-files-scope")).toHaveCount(0);
    const unscoped = await header.boundingBox();

    expect(scoped?.height).toBe(unscoped?.height);
  } finally {
    await seeded.cleanup();
  }
});

test("Command+Enter opens changed files in Changes and keeps missing files in the dialog", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const changedPath = "src/command-center-changed.ts";
  const secondChangedPath = "src/command-center-second-changed.ts";
  const unchangedPath = "src/command-center-unchanged.ts";
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-open-changes-",
    title: "Command Center Changes navigation",
    repo: {
      files: [
        { path: changedPath, content: "export const changed = 1;\n" },
        { path: secondChangedPath, content: "export const secondChanged = 1;\n" },
        { path: unchangedPath, content: "export const unchanged = true;\n" },
      ],
    },
  });

  try {
    await writeFile(path.join(seeded.repoPath, changedPath), "export const changed = 2;\n");
    await writeFile(
      path.join(seeded.repoPath, secondChangedPath),
      "export const secondChanged = 2;\n",
    );
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    let panel = page.getByTestId("command-center-panel");
    await panel.getByTestId("command-center-input").fill("command-center-changed");
    await expect(panel.getByRole("button", { name: /command-center-changed\.ts/ })).toBeVisible();
    await page.keyboard.press("Meta+Enter");

    await expect(panel).toBeHidden({ timeout: 30_000 });
    const changes = page.getByTestId("explorer-content-area");
    await expect(changes).toBeVisible();
    await expect(
      changes.getByTestId("diff-file-0-toggle").getByText("command-center-changed.ts", {
        exact: true,
      }),
    ).toBeInViewport();
    await expect(page.getByTestId("working-diff-panel")).toHaveCount(0);

    await page.getByTestId("changes-open-tab").click();
    await expect(page.getByTestId("working-diff-panel")).toBeVisible();
    await page.getByTestId("explorer-tab-files").click();
    await page.keyboard.press("Meta+P");
    panel = page.getByTestId("command-center-panel");
    await panel.getByTestId("command-center-input").fill("command-center-second-changed");
    await expect(
      panel.getByRole("button", { name: /command-center-second-changed\.ts/ }),
    ).toBeVisible();
    await page.keyboard.press("Meta+Enter");
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("explorer-tab-changes")).toBeVisible();
    await expect(
      changes.getByText("command-center-second-changed.ts", { exact: true }).first(),
    ).toBeInViewport();

    await page.keyboard.press("Meta+P");
    panel = page.getByTestId("command-center-panel");
    await panel.getByTestId("command-center-input").fill("command-center-unchanged");
    await expect(panel.getByRole("button", { name: /command-center-unchanged\.ts/ })).toBeVisible();
    await page.keyboard.press("Meta+Enter");

    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("command-center-file-action-error")).toHaveText(
      "This file is not present in Changes.",
    );
  } finally {
    await seeded.cleanup();
  }
});

test("unscoped command search keeps commands visible and reports file-search failures", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedMatchingWorkspaces(9);

  try {
    await failDirectorySuggestionRequests(page);
    await gotoWorkspace(page, seeded[0].workspaceId);
    const panel = await openCommandCenter(page);
    await panel.getByTestId("command-center-input").fill("home");

    await expect(panel.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Home failure 08/ })).toBeVisible();
    await expect(panel.getByTestId("command-center-file-search-error")).toHaveText(
      "Error: Test file search transport failure.",
    );
    await expect(panel.getByTestId("command-center-file-search-error")).toBeInViewport({
      ratio: 1,
    });
    await expect(panel.getByText("No matches", { exact: true })).toHaveCount(0);
  } finally {
    await Promise.allSettled(seeded.map((workspace) => workspace.cleanup()));
  }
});

test("an older host reports that exhaustive file search requires an update", async ({ page }) => {
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-file-search-old-host-",
    title: "Old file-search host",
  });

  try {
    const gate = await hideWorkspaceFileSearchCapability(page);
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await panel.getByTestId("command-center-input").fill("README.md");
    await expect(panel.getByTestId("command-center-file-search-unsupported-host")).toHaveText(
      "Update this host to search all workspace files.",
    );
    await expect(panel.getByText("No matches", { exact: true })).toHaveCount(0);
    expect(gate.requestCount()).toBe(0);
  } finally {
    await seeded.cleanup();
  }
});
test("an absolute path opens and edits a file outside the active workspace", async ({ page }) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-absolute-file-search-",
    title: "Absolute file search",
  });
  const outside = await mkdtemp(path.join(tmpdir(), "paseo-command-center-outside-"));
  const target = path.join(outside, "AGENTS.md");

  try {
    await writeFile(target, "# Before\n", "utf8");
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await panel.getByTestId("command-center-input").fill(target.slice(0, -3));
    const row = panel.getByRole("button", { name: `AGENTS.md ${outside}` });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expectFileTabOpen(page, target);
    await page.getByTestId("file-panel-bar").getByRole("button", { name: "Source" }).click();
    const editor = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-content");
    await editor.click();
    await editor.press("Meta+A");
    await editor.type("# After\n");
    await expect.poll(() => readFile(target, "utf8")).toBe("# After\n");
  } finally {
    await seeded.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});

test("an older host blocks only absolute-path file search", async ({ page }) => {
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-absolute-file-search-old-host-",
    title: "Old absolute file-search host",
  });

  try {
    const gate = await hideAbsoluteFileSearchCapability(page);
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await panel.getByTestId("command-center-input").fill("/raid/werquinigo/AGENTS.md");
    await expect(panel.getByTestId("command-center-file-search-unsupported-host")).toHaveText(
      "Update this host to search absolute file paths.",
    );
    expect(gate.requestCount()).toBe(0);
  } finally {
    await seeded.cleanup();
  }
});
