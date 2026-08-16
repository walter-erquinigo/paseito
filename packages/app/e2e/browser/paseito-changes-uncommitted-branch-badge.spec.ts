import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

const CLEAN_SOURCE = "export const branchState = 'clean';\n";
const DIRTY_SOURCE = "export const branchState = 'dirty';\n";

test("the branch badge follows dirtiness independently of the selected comparison", async ({
  page,
}) => {
  const repo = await createTempGitRepo("changes-uncommitted-badge-", {
    files: [{ path: "src/branch-state.ts", content: CLEAN_SOURCE }],
  });
  const client = await connectSeedClient();

  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create badge workspace");
    }

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(buildHostWorkspaceRoute(getServerId(), created.workspace.id));
    await waitForWorkspaceTabsVisible(page);
    await page.getByRole("button", { name: "Open explorer" }).click();
    await expect(page.getByTestId("changes-header")).toBeVisible({ timeout: 30_000 });

    const badge = page.getByTestId("changes-uncommitted-badge");
    const comparison = page.getByTestId("changes-diff-status-trigger");
    await expect(badge).toHaveCount(0);

    await writeFile(path.join(repo.path, "src/branch-state.ts"), DIRTY_SOURCE);
    await expect(badge).toHaveText("Uncommitted", { timeout: 30_000 });

    await comparison.click();
    await page.getByTestId("changes-diff-mode-committed").click();
    await expect(comparison).toContainText("Committed");
    await expect(badge).toHaveText("Uncommitted");

    await writeFile(path.join(repo.path, "src/branch-state.ts"), CLEAN_SOURCE);
    await expect(badge).toHaveCount(0, { timeout: 30_000 });
    await expect(comparison).toContainText("Committed");
  } finally {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  }
});
