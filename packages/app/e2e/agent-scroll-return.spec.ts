import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { readScrollMetrics, scrollChatAwayFromBottom } from "./helpers/agent-bottom-anchor";
import { expectAgentTabActive } from "./helpers/launcher";
import {
  buildAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "./helpers/mock-agent";
import { getServerId } from "./helpers/server-id";
import { openMobileAgentSidebar } from "./helpers/sidebar";
import {
  expectTimelinePromptVisible,
  openAgentTimeline,
  seedLongMockAgentTimeline,
} from "./helpers/timeline-pagination";
import { switchWorkspaceViaSidebar } from "./helpers/workspace-ui";

async function expectChatAtBottom(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readScrollMetrics(page)).distanceFromBottom, {
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(72);
}

async function openCompactWorkspace(
  page: Page,
  workspace: Pick<MockAgentWorkspace, "workspaceId">,
): Promise<void> {
  await openMobileAgentSidebar(page);
  await switchWorkspaceViaSidebar({
    page,
    serverId: getServerId(),
    workspaceId: workspace.workspaceId,
  });
}

async function openAgentTab(page: Page, workspaceId: string, agentId: string): Promise<void> {
  await page.goto(buildAgentRoute(workspaceId, agentId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
  await expectAgentTabActive(page, agentId);
}

async function selectAgentTab(page: Page, agentId: string): Promise<void> {
  await page
    .getByTestId(`workspace-tab-agent_${agentId}`)
    .filter({ visible: true })
    .first()
    .click();
  await expectAgentTabActive(page, agentId);
}

function armDelayedScrollForHiddenChat(page: Page): Promise<void> {
  return page
    .locator('[data-testid="agent-chat-scroll"]:visible')
    .first()
    .evaluate((root) => {
      const scroll = root as HTMLElement;
      return new Promise<void>((resolve) => {
        const observer = new ResizeObserver(() => {
          if (scroll.getClientRects().length > 0) return;
          observer.disconnect();
          scroll.dispatchEvent(new Event("scroll"));
          resolve();
        });
        observer.observe(scroll);
      });
    });
}

test("agent tab switches preserve following and intentional reading positions", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const otherAgent = await longChat.client.createAgent({
    provider: "mock",
    model: "ten-second-stream",
    modeId: "load-test",
    cwd: longChat.cwd,
    workspaceId: longChat.workspaceId,
    title: "Other agent tab",
  });
  const streamingPrompt = "Continue streaming while this agent tab is hidden";

  try {
    await page.setViewportSize({ width: 1280, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await openAgentTab(page, longChat.workspaceId, otherAgent.id);
    await selectAgentTab(page, longChat.agentId);
    await expectChatAtBottom(page);

    await longChat.client.sendAgentMessage(longChat.agentId, streamingPrompt);
    await longChat.client.waitForAgentUpsert(
      longChat.agentId,
      (snapshot) => snapshot.status === "running",
      15_000,
    );
    await selectAgentTab(page, otherAgent.id);
    await selectAgentTab(page, longChat.agentId);
    await expectTimelinePromptVisible(page, streamingPrompt);
    await expectChatAtBottom(page);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);
    await expectChatAtBottom(page);

    const readingPosition = await scrollChatAwayFromBottom(page, {
      deltaY: -900,
      minDistanceFromBottom: 300,
    });
    await selectAgentTab(page, otherAgent.id);
    await selectAgentTab(page, longChat.agentId);
    await expect
      .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - readingPosition.offsetY))
      .toBeLessThanOrEqual(24);
  } finally {
    await longChat.cleanup();
  }
});

test("workspace switches ignore hidden scroll delivery and preserve both viewport modes", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const otherWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "scroll-return-other-",
    title: "Other workspace",
  });
  const backgroundPrompt = "emit 500 coalesced agent stream updates";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await expectChatAtBottom(page);

    const delayedScrollDelivered = armDelayedScrollForHiddenChat(page);
    await openCompactWorkspace(page, otherWorkspace);
    await delayedScrollDelivered;
    await longChat.client.sendAgentMessage(longChat.agentId, backgroundPrompt);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);
    await openCompactWorkspace(page, longChat);
    await expectTimelinePromptVisible(page, backgroundPrompt);
    await expectChatAtBottom(page);

    const readingPosition = await scrollChatAwayFromBottom(page, {
      deltaY: -900,
      minDistanceFromBottom: 300,
    });
    await openCompactWorkspace(page, otherWorkspace);
    await openCompactWorkspace(page, longChat);
    await expect
      .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - readingPosition.offsetY))
      .toBeLessThanOrEqual(24);
  } finally {
    await Promise.allSettled([longChat.cleanup(), otherWorkspace.cleanup()]);
  }
});
