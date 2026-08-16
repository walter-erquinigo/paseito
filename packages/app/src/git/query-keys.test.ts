import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  checkoutDiffQueryKey,
  checkoutCommitsQueryKey,
  checkoutPrStatusQueryKey,
  checkoutStatusQueryKey,
  invalidateCheckoutGitQueriesForClient,
  invalidateCheckoutGitQueriesForServer,
  invalidateCheckoutComparisonQueriesForClient,
} from "@/git/query-keys";
import {
  prPanePipelineQueryKey,
  prPaneTimelineQueryKey,
} from "@/git/pull-request-panel/query-keys";

describe("checkout query keys", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo";

  it("invalidates every query for a checkout without touching other checkouts", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), { isGit: true });
    queryClient.setQueryData(checkoutDiffQueryKey(serverId, cwd, "base", "main", true), {
      files: [],
    });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, cwd), { status: { number: 12 } });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, cwd), { commits: [] });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, cwd, "origin/release"), {
      commits: [],
    });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, "/tmp/other"), { commits: [] });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }), {
      items: [],
    });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 13 }), {
      items: [],
    });
    queryClient.setQueryData(
      prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      {
        stages: [],
      },
    );
    queryClient.setQueryData(
      prPaneTimelineQueryKey({ serverId, cwd: "/tmp/other", prNumber: 12 }),
      { items: [] },
    );
    queryClient.setQueryData(
      prPanePipelineQueryKey({
        serverId,
        cwd: "/tmp/other",
        pipelineId: 9001,
        changeRequestNumber: 1,
      }),
      { stages: [] },
    );

    await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, cwd, "base", "main", true))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(checkoutPrStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(checkoutCommitsQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutCommitsQueryKey(serverId, cwd, "origin/release"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(checkoutCommitsQueryKey(serverId, "/tmp/other"))?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 13 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPaneTimelineQueryKey({ serverId, cwd: "/tmp/other", prNumber: 12 }),
      )?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(
        prPanePipelineQueryKey({
          serverId,
          cwd: "/tmp/other",
          pipelineId: 9001,
          changeRequestNumber: 1,
        }),
      )?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });

  it("invalidates fetch-based checkout queries server-wide without touching other servers", async () => {
    const queryClient = new QueryClient();
    const otherServerId = "server-2";
    const otherCwd = "/tmp/repo-2";

    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), { isGit: true });
    queryClient.setQueryData(checkoutStatusQueryKey(serverId, otherCwd), { isGit: true });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, cwd), { status: { number: 12 } });
    queryClient.setQueryData(checkoutCommitsQueryKey(serverId, cwd), { commits: [] });
    queryClient.setQueryData(checkoutCommitsQueryKey(otherServerId, cwd), { commits: [] });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }), {
      items: [],
    });
    queryClient.setQueryData(
      prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      {
        stages: [],
      },
    );
    // Subscription-fed diff queries are deliberately not part of the server-wide sweep.
    queryClient.setQueryData(checkoutDiffQueryKey(serverId, cwd, "base", "main", true), {
      files: [],
    });
    queryClient.setQueryData(checkoutStatusQueryKey(otherServerId, cwd), { isGit: true });

    await invalidateCheckoutGitQueriesForServer(queryClient, serverId);

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutStatusQueryKey(serverId, otherCwd))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(checkoutPrStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(checkoutCommitsQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutCommitsQueryKey(otherServerId, cwd))?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPanePipelineQueryKey({ serverId, cwd, pipelineId: 9001, changeRequestNumber: 1 }),
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, cwd, "base", "main", true))
        ?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(checkoutStatusQueryKey(otherServerId, cwd))?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });

  it("invalidates every cached comparison when the selected base changes", async () => {
    const queryClient = new QueryClient();
    const otherCwd = "/tmp/other";
    const diffKey = checkoutDiffQueryKey(serverId, cwd, "base", "main", false);
    const alternateDiffKey = checkoutDiffQueryKey(serverId, cwd, "base", "origin/release", false);
    const commitKey = checkoutCommitsQueryKey(serverId, cwd, "main");
    const alternateCommitKey = checkoutCommitsQueryKey(serverId, cwd, "origin/release");

    for (const key of [diffKey, alternateDiffKey, commitKey, alternateCommitKey]) {
      queryClient.setQueryData(key, {});
    }
    queryClient.setQueryData(checkoutDiffQueryKey(serverId, otherCwd, "base", "main"), {});

    await invalidateCheckoutComparisonQueriesForClient(queryClient, { serverId, cwd });

    for (const key of [diffKey, alternateDiffKey, commitKey, alternateCommitKey]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, otherCwd, "base", "main"))
        ?.isInvalidated,
    ).toBe(false);
    queryClient.clear();
  });
});
