import { expect, test, type Page } from "../../app/e2e/support/fixtures";
import { openSettings } from "../../app/e2e/support/helpers/app";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import { openSettingsHost, openSettingsHostSection } from "../../app/e2e/support/helpers/settings";
import { installDesktopRuntime } from "./support/runtime";

async function lastInvocationArgs(page: Page, command: string): Promise<unknown> {
  return await page.evaluate(
    (target) =>
      window.__capturedDesktopInvocations.findLast((entry) => entry.command === target)?.args,
    command,
  );
}

test("manages trusted desktop MR plugins independently of the selected daemon", async ({
  page,
  withWorkspace,
}) => {
  const serverId = getServerId();
  await installDesktopRuntime(page, {
    serverId,
    commandResponses: {
      desktop_mr_plugin_list: [
        {
          id: "example-automation",
          path: "/Users/example/Developer/example-automation",
          enabled: true,
          status: "running",
          error: null,
        },
      ],
      desktop_mr_plugin_logs: [
        {
          sequence: 1,
          timestamp: "2026-08-27T12:00:00.000Z",
          stream: "stdout",
          message: "Plugin ready",
        },
      ],
      desktop_mr_plugin_install: null,
    },
  });
  const workspace = await withWorkspace({ prefix: "desktop-mr-plugins-" });
  await workspace.navigateTo();
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openSettingsHostSection(page, serverId, "plugins");

  await expect(page.getByText("Desktop MR automation plugins", { exact: true })).toBeVisible();
  await expect(page.getByText("example-automation", { exact: true })).toBeVisible();
  await expect(page.getByText("running", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "They run locally in the Paseito desktop process without sandboxing. Install only code you trust.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Logs", exact: true }).first().click();
  await expect(page.getByText(/Plugin ready/)).toBeVisible();

  await page.getByPlaceholder("/absolute/path/on/this/Mac").fill("/tmp/example-plugin");
  await page.getByPlaceholder("Manifest default").first().fill("installed-example");
  await page.getByRole("button", { name: "Install directory", exact: true }).first().click();
  await expect
    .poll(() => lastInvocationArgs(page, "desktop_mr_plugin_install"))
    .toEqual({ directory: "/tmp/example-plugin", id: "installed-example" });
});
