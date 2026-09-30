import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

// The private fixture identifies an existing open MR. All forge operations are reads;
// branch changes happen only in the disposable local project.
const FixtureSchema = z.object({
  remote: z.string(),
  branch: z.string(),
  prefix: z.string(),
  index: z.string(),
  mrNumber: z.number(),
  mrUrl: z.string(),
});

test("a real MR link opens independently of branch checkout", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = FixtureSchema.parse(
    JSON.parse(readFileSync(process.env.PASEITO_STACK_QA_FIXTURE!, "utf8")),
  );
  const workspace = await seedWorkspace({
    repoPrefix: "workspace-stack-forge-",
    repo: { branches: ["main"] },
  });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspace.repoPath, encoding: "utf8", stdio: "pipe" }).trim();
  const stem = `${fixture.prefix}-${fixture.index}-`;
  const namespace = fixture.branch.slice(0, fixture.branch.lastIndexOf(stem));
  const child = `${namespace}${fixture.prefix}-${fixture.index}z-paseito-qa`;
  try {
    git("remote", "add", "origin", fixture.remote);
    git("checkout", "-b", fixture.branch);
    git(
      "commit",
      "--allow-empty",
      "-m",
      `Parent\n\nStack-Prefix: ${fixture.prefix}\nStack-Index: ${fixture.index}\nStack-Parent: main`,
    );
    git("checkout", "-b", child);
    git(
      "commit",
      "--allow-empty",
      "-m",
      `Child\n\nStack-Prefix: ${fixture.prefix}\nStack-Index: ${fixture.index}z\nStack-Parent: ${fixture.branch}`,
    );
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: workspace.workspaceId,
    });
    await page.getByTestId("workspace-stack-trigger").click();
    const row = page.getByTestId(`workspace-stack-branch-${fixture.branch}`);
    const link = row.getByRole("button", {
      name: `Open MR !${fixture.mrNumber} for ${fixture.branch} in the system browser`,
    });
    await expect(link).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: testInfo.outputPath("stack-real-mr.png") });
    const popupPromise = page.waitForEvent("popup");
    const navigationPromise = page
      .context()
      .waitForEvent(
        "request",
        (request) => request.isNavigationRequest() && request.url() === fixture.mrUrl,
      );
    await link.click();
    const popup = await popupPromise;
    // A fresh browser profile may be redirected to sign-in after requesting the MR.
    const navigation = await navigationPromise;
    expect(navigation.url()).toBe(fixture.mrUrl);
    expect(git("branch", "--show-current")).toBe(child);
    await expect(row).toHaveAttribute("aria-checked", "false");
    await popup.close();
  } finally {
    await workspace.cleanup();
  }
});
