import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PullRequestTimelineResponse } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { prPaneTimelineQueryKey } from "@/git/pull-request-panel/query-keys";
import { useFetchQuery } from "@/data/query";

type TimelinePayload = PullRequestTimelineResponse["payload"];

function resolveDiscussionContext(pr: ReturnType<typeof useCheckoutPrStatusQuery>) {
  const number = pr.status?.number ?? null;
  return {
    number,
    repoOwner: pr.status?.repoOwner ?? null,
    repoName: pr.status?.repoName ?? null,
    mrUrl: pr.status?.url ?? null,
    isGitLabMr: pr.forge === "gitlab" && number !== null,
  };
}

function allAvailable(values: unknown[]): boolean {
  return values.every(Boolean);
}

function timelineError(query: { error: Error | null; data?: TimelinePayload }): Error | null {
  if (query.error) return query.error;
  return query.data?.error ? new Error(query.data.error.message) : null;
}

export function useChangesDiscussions(input: { serverId: string; cwd: string; enabled: boolean }) {
  const client = useHostRuntimeClient(input.serverId);
  const connected = useHostRuntimeIsConnected(input.serverId);
  const queryClient = useQueryClient();
  const pr = useCheckoutPrStatusQuery({
    serverId: input.serverId,
    cwd: input.cwd,
    enabled: input.enabled,
  });
  const supported = useSessionStore(
    (state) =>
      state.sessions[input.serverId]?.serverInfo?.features?.changesForgeDiscussionsV1 === true,
  );
  const { number, repoOwner, repoName, mrUrl, isGitLabMr } = resolveDiscussionContext(pr);
  const queryKey = useMemo(
    () => prPaneTimelineQueryKey({ serverId: input.serverId, cwd: input.cwd, prNumber: number }),
    [input.cwd, input.serverId, number],
  );
  const canFetch = allAvailable([
    input.enabled,
    supported,
    connected,
    client,
    isGitLabMr,
    repoOwner,
    repoName,
  ]);
  const query = useFetchQuery<TimelinePayload>({
    queryKey,
    queryFn: async () => {
      if (!client || number === null || !repoOwner || !repoName) {
        throw new Error("GitLab discussion context is unavailable");
      }
      return client.pullRequestTimeline({
        cwd: input.cwd,
        prNumber: number,
        repoOwner,
        repoName,
      });
    },
    enabled: canFetch,
    refetchInterval: canFetch ? 60_000 : false,
    refetchIntervalInBackground: false,
    dataShape: "value",
    staleTimeMs: 30_000,
  });

  const refresh = useCallback(async () => {
    if (canFetch) await query.refetch();
  }, [canFetch, query]);

  const reply = useCallback(
    async (discussionId: string, body: string) => {
      if (!client || number === null) throw new Error("GitLab discussion context is unavailable");
      const response = await client.replyToForgeDiscussion({
        cwd: input.cwd,
        changeRequestNumber: number,
        discussionId,
        body,
      });
      if (response.error) throw new Error(response.error.message);
      if (response.comment) {
        queryClient.setQueryData<TimelinePayload>(queryKey, (current) =>
          current ? { ...current, items: [...current.items, response.comment!] } : current,
        );
      }
      void queryClient.invalidateQueries({ queryKey });
      return response.comment;
    },
    [client, input.cwd, number, queryClient, queryKey],
  );

  return {
    supported,
    isGitLabMr,
    number,
    mrUrl,
    items: query.data?.items ?? [],
    truncated: query.data?.truncated === true,
    error: timelineError(query),
    isLoading: canFetch && query.data === undefined && query.isLoading,
    isRefreshing: query.isFetching && query.data !== undefined,
    refresh,
    reply,
  };
}
