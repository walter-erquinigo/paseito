import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

test("Stack shows all branches, marks the current one, and refuses dirty switches without stashing", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workspace = await seedWorkspace({
    repoPrefix: "workspace-stack-",
    repo: { branches: ["main"] },
  });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspace.repoPath, encoding: "utf8", stdio: "pipe" }).trim();
  const a = "developer/review-a-foundation";
  const b = "developer/review-b-middle";
  const c = "developer/review-c-top";
  try {
    for (const [name, index, parent] of [
      [a, "a", "main"],
      [b, "b", a],
      [c, "c", b],
    ]) {
      git("checkout", "-b", name!, parent!);
      git(
        "commit",
        "--allow-empty",
        "-m",
        `Change ${index}\n\nStack-Prefix: review\nStack-Index: ${index}\nStack-Parent: ${parent}\nStack-Issue: TASK-42`,
      );
    }
    git("checkout", b);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: workspace.workspaceId,
    });
    await page.getByTestId("workspace-stack-trigger").click();
    const menu = page.getByTestId("workspace-stack-menu");
    const rowA = page.getByTestId(`workspace-stack-branch-${a}`);
    const rowB = page.getByTestId(`workspace-stack-branch-${b}`);
    const rowC = page.getByTestId(`workspace-stack-branch-${c}`);
    await expect(menu).toBeVisible();
    await expect(rowA).toBeVisible();
    await expect(rowB).toHaveAttribute("aria-checked", "true");
    await expect(rowC).toBeVisible();
    await expect(menu.getByText("No MR", { exact: true })).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("stack-open.png") });

    writeFileSync(join(workspace.repoPath, "pending-stack.txt"), "untracked work\n");
    await rowA.click();
    await expect(menu.getByRole("alert")).toContainText("uncommitted changes");
    expect(git("branch", "--show-current")).toBe(b);
    expect(git("stash", "list")).toBe("");
    await page.screenshot({ path: testInfo.outputPath("stack-dirty-error.png") });

    git("add", "pending-stack.txt");
    await rowA.click();
    await expect(menu.getByRole("alert")).toContainText("uncommitted changes");
    expect(git("branch", "--show-current")).toBe(b);
    git("reset", "--", "pending-stack.txt");
    unlinkSync(join(workspace.repoPath, "pending-stack.txt"));
    await rowA.click();
    await expect(rowA).toHaveAttribute("aria-checked", "true");
    expect(git("branch", "--show-current")).toBe(a);
    await expect(menu.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("stack-switched.png") });
    await page.setViewportSize({ width: 800, height: 650 });
    await expect(rowC).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await menu.boundingBox();
        return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= 800;
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("stack-narrow.png") });
  } finally {
    await workspace.cleanup();
  }
});
