import { expect, test, type Page } from "../../app/e2e/support/fixtures";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import type { MRTrackerViewState } from "../../app/src/mr-tracker/types";
import { installDesktopRuntime } from "./support/runtime";

const MR_ID = "example/constellation!42";
const MR_URL = "https://gitlab.example.com/example/constellation/-/merge_requests/42";
const IGNORED_MR_TITLE = "Remove legacy constellation renderer";

async function getOpenUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__capturedOpenUrls);
}

async function getOpenUrlCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__capturedOpenUrls.length);
}

async function getImportanceInvocationCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      window.__capturedDesktopInvocations.filter((entry) => entry.command === "set_mr_importance")
        .length,
  );
}

async function getLastImportanceValue(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const invocations = window.__capturedDesktopInvocations.filter(
      (entry) => entry.command === "set_mr_importance",
    );
    return invocations.at(-1)?.args?.importance;
  });
}

async function getLastDesktopInvocationArgs(page: Page, command: string): Promise<unknown> {
  return page.evaluate(
    (targetCommand) =>
      window.__capturedDesktopInvocations.findLast((entry) => entry.command === targetCommand)
        ?.args,
    command,
  );
}

async function getDesktopInvocationCount(page: Page, command: string): Promise<number> {
  return page.evaluate((targetCommand) => {
    let count = 0;
    for (const entry of window.__capturedDesktopInvocations) {
      if (entry.command === targetCommand) count += 1;
    }
    return count;
  }, command);
}

function trackerState(): MRTrackerViewState {
  const state: MRTrackerViewState = {
    status: "ready",
    settings: {
      gitLabBaseUrl: "https://gitlab.example.com",
      gitLabUsername: "ada",
      authors: [],
      activityUsers: [
        {
          id: 80,
          name: "Greptile",
          username: "group_bot",
          webUrl: null,
          avatarUrl: null,
        },
      ],
      includeReviewerMergeRequests: true,
      tokenType: "private-token",
      refreshIntervalSeconds: 120,
    },
    hasToken: true,
    mergeRequests: [
      {
        id: MR_ID,
        projectId: 7,
        projectPath: "example/constellation",
        iid: 42,
        title: "Refine constellation rendering across every display size",
        description: "",
        webUrl: MR_URL,
        state: "opened",
        sourceBranch: "feature/constellation-rendering",
        targetBranch: "main",
        sourceSha: "abc123",
        createdAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-21T01:00:00.000Z",
        draft: false,
        author: {
          id: 10,
          name: "Ada Lovelace",
          username: "ada",
          webUrl: null,
          avatarUrl: null,
        },
        assignees: [],
        reviewers: [],
        labels: ["frontend"],
        pipeline: {
          id: 99,
          status: "success",
          webUrl: null,
          updatedAt: "2026-08-21T01:00:00.000Z",
        },
        approvals: {
          approvedBy: [],
          approvalsRequired: 1,
          approvalsLeft: 1,
          rulesLeft: 1,
          error: null,
        },
        discussions: {
          unresolvedCount: 0,
          resolvableCount: 0,
          activity: [
            {
              user: {
                id: 80,
                name: "Greptile",
                username: "group_bot",
                webUrl: null,
                avatarUrl: null,
              },
              noteCount: 0,
              unresolvedCount: 0,
            },
            {
              user: {
                id: 81,
                name: "Aman",
                username: "aman",
                webUrl: null,
                avatarUrl: null,
              },
              noteCount: 2,
              unresolvedCount: 1,
            },
            {
              user: {
                id: 82,
                name: "Lint bot",
                username: "lint_bot",
                webUrl: null,
                avatarUrl: null,
              },
              noteCount: 0,
              unresolvedCount: 0,
            },
          ],
          error: null,
        },
        mergeStatus: "can_be_merged",
        detailedMergeStatus: "mergeable",
        blockingDiscussionsResolved: true,
        sources: ["owned"],
        tracked: true,
        importance: "important",
        isOwned: true,
        isReviewer: false,
        hasMergeConflict: false,
        isReady: true,
        needsAttention: true,
      },
    ],
    lastUpdated: "2026-08-21T01:00:00.000Z",
    errors: [],
    counts: { all: 2, my_mrs: 2, others: 0 },
  };
  const important = state.mergeRequests[0];
  if (!important) throw new Error("Expected the Important MR fixture.");
  state.mergeRequests.push({
    ...important,
    id: "example/constellation!43",
    iid: 43,
    title: IGNORED_MR_TITLE,
    webUrl: "https://gitlab.example.com/example/constellation/-/merge_requests/43",
    sourceBranch: "feature/remove-legacy-renderer",
    importance: "ignored",
    isOwned: false,
    isReviewer: true,
    isReady: false,
    needsAttention: false,
  });
  return state;
}

test.describe("MR tracker row interactions", () => {
  test("searches and selects an exact GitLab activity account", async ({ page, withWorkspace }) => {
    const state = trackerState();
    state.settings.activityUsers = [];
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      commandResponses: {
        get_mr_tracker_state: state,
        search_mr_tracker_users: [
          {
            id: 80,
            name: "Greptile",
            username: "group_bot",
            webUrl: null,
            avatarUrl: null,
          },
        ],
        save_mr_tracker_settings: state,
      },
    });
    const workspace = await withWorkspace({ prefix: "mr-tracker-settings-" });
    await workspace.navigateTo();
    await page.getByRole("button", { name: "MR tracker settings", exact: true }).click();
    await expect(page.getByText("Always-show activity badges", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add always-show user", exact: true }).click();
    await page.getByPlaceholder("Search GitLab users").fill("Greptile");
    await expect(page.getByRole("button", { name: "Greptile", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Greptile", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText("@group_bot", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => getLastDesktopInvocationArgs(page, "save_mr_tracker_settings"))
      .toMatchObject({
        activityUsers: [{ id: 80, username: "group_bot", name: "Greptile" }],
      });
  });

  test("keeps GitLab activity search failures visible for retry", async ({
    page,
    withWorkspace,
  }) => {
    const state = trackerState();
    state.settings.activityUsers = [];
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      commandResponses: { get_mr_tracker_state: state },
      commandErrors: { search_mr_tracker_users: "GitLab user search unavailable." },
    });
    const workspace = await withWorkspace({ prefix: "mr-tracker-settings-error-" });
    await workspace.navigateTo();
    await page.getByRole("button", { name: "MR tracker settings", exact: true }).click();
    await page.getByRole("button", { name: "Add always-show user", exact: true }).click();
    await page.getByPlaceholder("Search GitLab users").fill("Greptile");

    await expect(page.getByText("GitLab user search unavailable.", { exact: true })).toBeVisible();
    await page.getByPlaceholder("Search GitLab users").fill("Greptile bot");
    await expect.poll(() => getDesktopInvocationCount(page, "search_mr_tracker_users")).toBe(2);
  });

  test("filters Important MRs and isolates open, expand, and triage actions", async ({
    page,
    withWorkspace,
  }) => {
    const state = trackerState();
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      commandResponses: {
        get_mr_tracker_state: state,
        set_mr_importance: state,
      },
    });
    await page.setViewportSize({ width: 1800, height: 1000 });
    const workspace = await withWorkspace({ prefix: "mr-tracker-row-" });
    await workspace.navigateTo();
    await page.getByTestId("mr-sidebar-all").click();

    const summary = page.getByTestId(`mr-summary-${MR_ID}`);
    const cue = page.getByTestId(`mr-open-cue-${MR_ID}`);
    const importance = page.getByTestId("mr-importance");
    const importantOnly = page.getByTestId("mr-tracker-important-only");
    await expect(summary).toBeVisible();
    await expect(importance.first()).toBeVisible();
    await expect(page.getByText(IGNORED_MR_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText("Greptile · No activity", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Aman · Open", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Lint bot · No activity", { exact: true })).toHaveCount(0);

    await importantOnly.click();
    await expect(importantOnly).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(IGNORED_MR_TITLE, { exact: true })).toHaveCount(0);
    await expect(summary).toBeVisible();

    await importantOnly.click();
    await expect(page.getByText(IGNORED_MR_TITLE, { exact: true })).toBeVisible();
    await importantOnly.click();
    await expect(page.getByText(IGNORED_MR_TITLE, { exact: true })).toHaveCount(0);

    const cueBefore = await cue.boundingBox();
    await expect(cue).toHaveCSS("opacity", "0");
    await summary.hover();
    await expect(cue).toHaveCSS("opacity", "1");
    expect(await cue.boundingBox()).toEqual(cueBefore);

    const importanceBox = await importance.boundingBox();
    expect(importanceBox).not.toBeNull();
    expect(importanceBox?.x).toBeLessThan(700);

    await page.getByTestId(`mr-expand-${MR_ID}`).click();
    await expect(page.getByText("feature/constellation-rendering", { exact: true })).toBeVisible();
    expect(await getOpenUrls(page)).toEqual([]);

    await page.getByTestId("mr-importance-ignored").click();
    await expect.poll(() => getImportanceInvocationCount(page)).toBe(1);
    expect(await getLastImportanceValue(page)).toBe("ignored");
    expect(await getOpenUrls(page)).toEqual([]);

    await page.getByText("feature/constellation-rendering", { exact: true }).click();
    expect(await getOpenUrls(page)).toEqual([]);

    await summary.click({ position: { x: 700, y: 18 } });
    await expect.poll(() => getOpenUrlCount(page)).toBe(1);
    expect((await getOpenUrls(page))[0]).toBe(MR_URL);

    await summary.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => getOpenUrlCount(page)).toBe(2);

    await page.setViewportSize({ width: 760, height: 900 });
    await expect(summary).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("repeated MR links reveal, expand, center, and highlight the requested row", async ({
    page,
    withWorkspace,
  }) => {
    const state = trackerState();
    const template = state.mergeRequests[0];
    if (!template) throw new Error("Expected the MR fixture.");
    for (let iid = 44; iid <= 58; iid += 1) {
      state.mergeRequests.push({
        ...template,
        id: `example/constellation!${iid}`,
        iid,
        title: `Constellation follow-up ${iid}`,
        webUrl: `https://gitlab.example.com/example/constellation/-/merge_requests/${iid}`,
        sourceBranch: `feature/constellation-${iid}`,
        importance: iid === 58 ? "ignored" : "important",
      });
    }
    await installDesktopRuntime(page, {
      serverId: getServerId(),
      commandResponses: { get_mr_tracker_state: state },
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const workspace = await withWorkspace({ prefix: "mr-tracker-link-" });
    await workspace.navigateTo();
    await page.getByTestId("mr-sidebar-all").click();
    await page.getByTestId("mr-tracker-important-only").click();

    const targetId = "example/constellation!58";
    await page.evaluate(
      ({ mergeRequestId }) =>
        window.__emitDesktopEvent?.("open-mr", {
          mergeRequestId,
          tab: "my_mrs",
          revision: 1,
        }),
      { mergeRequestId: targetId },
    );

    const row = page.getByTestId(`mr-row-${targetId}`);
    const highlight = page.getByTestId(`mr-focus-highlight-${targetId}`);
    await expect(row).toBeVisible();
    await expect(page.getByText("feature/constellation-58", { exact: true })).toBeVisible();
    await expect(highlight).toBeVisible();
    await expect
      .poll(async () => {
        const box = await row.boundingBox();
        return Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - 360);
      })
      .toBeLessThan(150);

    await page.getByTestId(`mr-expand-${targetId}`).click();
    await expect(page.getByText("feature/constellation-58", { exact: true })).toHaveCount(0);
    await page.evaluate(
      ({ mergeRequestId }) =>
        window.__emitDesktopEvent?.("open-mr", {
          mergeRequestId,
          tab: "my_mrs",
          revision: 2,
        }),
      { mergeRequestId: targetId },
    );
    await expect(page.getByText("feature/constellation-58", { exact: true })).toBeVisible();
    await expect(highlight).toBeVisible();
  });
});
