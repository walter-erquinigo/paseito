import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  openChangesPanel,
  openChangesTreePanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

const CLEAN_SOURCE = "export const branchState = 'clean';\n";
const DIRTY_SOURCE = "export const branchState = 'dirty';\n";

async function hideAmendCapability(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => serverSocket.send(message));
    serverSocket.onMessage((message) => {
      if (typeof message !== "string") {
        browserSocket.send(message);
        return;
      }
      const envelope = JSON.parse(message) as {
        message?: {
          type?: string;
          payload?: { status?: string; features?: Record<string, unknown> };
        };
      };
      if (
        envelope.message?.type === "status" &&
        envelope.message.payload?.status === "server_info"
      ) {
        envelope.message.payload.features = {
          ...envelope.message.payload.features,
          checkoutCommitAmend: false,
        };
      }
      browserSocket.send(JSON.stringify(envelope));
    });
  });
}

async function showGitLabMergeRequest(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => serverSocket.send(message));
    serverSocket.onMessage((message) => {
      if (typeof message !== "string") {
        browserSocket.send(message);
        return;
      }
      const envelope = JSON.parse(message) as {
        message?: {
          type?: string;
          payload?: Record<string, unknown> & {
            features?: Record<string, unknown>;
            prStatus?: Record<string, unknown>;
          };
        };
      };
      const payload = envelope.message?.payload;
      if (envelope.message?.type === "status" && payload?.status === "server_info") {
        payload.features = { ...payload.features, changesForgeDiscussionsV1: true };
      }
      const gitLabStatus = {
        forge: "gitlab",
        projectPath: "example/repository",
        number: 42,
        url: "https://gitlab.example.com/example/repository/-/merge_requests/42",
        title: "Toolbar layout fixture",
        state: "open",
        baseRefName: "main",
        headRefName: "main",
        isMerged: false,
        isDraft: false,
        mergeable: "MERGEABLE",
        checks: [],
        repoOwner: "example",
        repoName: "repository",
      };
      if (envelope.message?.type === "checkout_pr_status_response" && payload) {
        payload.status = gitLabStatus;
        payload.forge = "gitlab";
        payload.authState = "authenticated";
        payload.githubFeaturesEnabled = true;
        payload.error = null;
      }
      if (envelope.message?.type === "checkout_status_update" && payload?.prStatus) {
        payload.prStatus = {
          ...payload.prStatus,
          status: gitLabStatus,
          forge: "gitlab",
          authState: "authenticated",
          githubFeaturesEnabled: true,
          error: null,
        };
      }
      browserSocket.send(JSON.stringify(envelope));
    });
  });
}

async function expectControlsDoNotOverlap(controls: ReturnType<Page["locator"]>[]): Promise<void> {
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  for (const box of boxes) expect(box).not.toBeNull();
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left]!;
      const b = boxes[right]!;
      const overlaps =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlaps, `controls ${left} and ${right} overlap`).toBe(false);
    }
  }
}

test("the branch badge amends changes independently of the selected comparison", async ({
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
    await showGitLabMergeRequest(page);
    await page.goto(buildHostWorkspaceRoute(getServerId(), created.workspace.id));
    await waitForWorkspaceTabsVisible(page);
    await openChangesTreePanel(page);
    await expect(page.getByTestId("changes-header")).toBeVisible({ timeout: 30_000 });

    const badge = page.getByTestId("changes-uncommitted-badge");
    const amend = page.getByTestId("changes-amend-button");
    const comparison = page.getByTestId("changes-diff-status-trigger");
    await expect(badge).toHaveCount(0);
    await expect(amend).toHaveCount(0);

    const originalSha = execSync("git rev-parse HEAD", { cwd: repo.path }).toString().trim();
    await writeFile(path.join(repo.path, "src/branch-state.ts"), DIRTY_SOURCE);
    await client.checkoutRefresh(repo.path);
    await openChangesPanel(page);
    await expect(badge).toHaveText("Uncommitted", { timeout: 30_000 });
    await expect(amend).toHaveText("Amend");

    const tree = page.getByTestId("changes-tree-panel");
    const branch = tree.getByTestId("changes-branch-switcher");
    const comments = tree.getByTestId("changes-discussions-button");
    const review = tree.getByTestId("changes-review-menu");
    const pullRequest = tree.getByTestId("changes-open-pull-request");
    const external = tree.getByTestId("changes-open-pull-request-external");
    const diffMode = tree.getByTestId("changes-diff-status-trigger");
    const base = tree.getByTestId("changes-base-selector");
    const refresh = tree.getByTestId("changes-refresh");
    const options = tree.getByTestId("changes-options-menu");
    await expect(comments).toHaveText("0");
    await expect(pullRequest).toContainText("!42");
    await expect
      .poll(async () => (await branch.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(40);
    await expectControlsDoNotOverlap([branch, badge, amend, pullRequest, external]);
    await expectControlsDoNotOverlap([diffMode, base, comments, review, refresh, options]);

    await comparison.click();
    await page.getByTestId("changes-diff-mode-committed").click();
    await expect(comparison).toContainText("Committed");
    await expect(badge).toHaveText("Uncommitted");

    await amend.click();
    await expect(badge).toHaveCount(0, { timeout: 30_000 });
    await expect(amend).toHaveCount(0);
    await expect(comparison).toContainText("Committed");
    expect(execSync("git rev-parse HEAD", { cwd: repo.path }).toString().trim()).not.toBe(
      originalSha,
    );
    expect(execSync("git rev-list --count HEAD", { cwd: repo.path }).toString().trim()).toBe("1");
    expect(execSync("git log -1 --format=%s", { cwd: repo.path }).toString().trim()).toBe(
      "Initial commit",
    );
    expect(execSync("git show HEAD:src/branch-state.ts", { cwd: repo.path }).toString()).toBe(
      DIRTY_SOURCE,
    );
  } finally {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  }
});

test("an older host leaves Amend visible and reports the required update", async ({ page }) => {
  const repo = await createTempGitRepo("changes-amend-old-host-", {
    files: [{ path: "src/branch-state.ts", content: CLEAN_SOURCE }],
  });
  const client = await connectSeedClient();

  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create amend workspace");
    }
    await hideAmendCapability(page);
    await writeFile(path.join(repo.path, "src/branch-state.ts"), DIRTY_SOURCE);
    const originalSha = execSync("git rev-parse HEAD", { cwd: repo.path }).toString().trim();

    await page.goto(buildHostWorkspaceRoute(getServerId(), created.workspace.id));
    await waitForWorkspaceTabsVisible(page);
    await openChangesPanel(page);
    const amend = page.getByTestId("changes-amend-button");
    await expect(amend).toBeVisible({ timeout: 30_000 });
    await amend.click();

    await expect(page.getByText("Update the host to amend changes", { exact: true })).toBeVisible();
    await expect(page.getByTestId("changes-uncommitted-badge")).toBeVisible();
    expect(execSync("git rev-parse HEAD", { cwd: repo.path }).toString().trim()).toBe(originalSha);
  } finally {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  }
});
