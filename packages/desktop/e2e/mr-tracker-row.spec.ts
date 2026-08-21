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

function trackerState(): MRTrackerViewState {
  const state: MRTrackerViewState = {
    status: "ready",
    settings: {
      gitLabBaseUrl: "https://gitlab.example.com",
      gitLabUsername: "ada",
      authors: [],
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
        discussions: { unresolvedCount: 0, resolvableCount: 0, error: null },
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
    isReady: false,
    needsAttention: false,
  });
  return state;
}

test.describe("MR tracker row interactions", () => {
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
});
