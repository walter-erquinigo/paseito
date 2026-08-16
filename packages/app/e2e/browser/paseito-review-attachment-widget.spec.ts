import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { submitMessage } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openChangesPanel } from "../support/helpers/workspace-tabs";

async function addInlineReviewComment(
  page: Page,
  gutterIndex: number,
  body: string,
): Promise<void> {
  const gutter = page.getByRole("button", { name: "Add review comment" }).nth(gutterIndex - 1);
  await expect(gutter).toBeVisible();
  const bounds = await gutter.boundingBox();
  if (!bounds) throw new Error("Review gutter has no pointer bounds");
  await gutter.click({ position: { x: bounds.width - 4, y: bounds.height / 2 } });

  const editor = page.getByTestId("inline-review-editor");
  await expect(editor).toBeVisible();
  await page.getByTestId("inline-review-editor-input").fill(body);
  await page.getByTestId("inline-review-editor-save").click();
  await expect(editor).toHaveCount(0);
}

test("expands a sent Review widget to show its comments", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "review-attachment-widget-e2e-",
    title: "Review attachment widget e2e",
  });

  try {
    const reviewedFile = path.join(session.cwd, "src/review-me.ts");
    await mkdir(path.dirname(reviewedFile), { recursive: true });
    await writeFile(reviewedFile, "export const first = 1;\nexport const second = 2;\n");
    await session.client.checkoutRefresh(session.cwd);

    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, session);
    await openChangesPanel(page);
    await expect(page.getByText("review-me.ts", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("diff-file-0-body")).toBeVisible();

    await addInlineReviewComment(page, 1, "Should the builder receive the optional name?");
    await addInlineReviewComment(page, 2, "Keep this fallback until existing callers migrate.");

    await page
      .getByTestId(`workspace-tab-agent_${session.agentId}`)
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByTestId("composer-review-attachment-pill")).toContainText("2 comments");

    await submitMessage(page, "Please address this review.");
    await expect(page.getByText("Please address this review.", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expectAgentIdle(page);

    const toggle = page.getByTestId("review-attachment-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("review-attachment-list")).toHaveCount(0);

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("review-attachment-item")).toHaveCount(2);
    await expect(page.getByText("src/review-me.ts · +1", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Should the builder receive the optional name?", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("src/review-me.ts · +2", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Keep this fallback until existing callers migrate.", { exact: true }),
    ).toBeVisible();

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("review-attachment-list")).toHaveCount(0);
  } finally {
    await session.cleanup();
  }
});
