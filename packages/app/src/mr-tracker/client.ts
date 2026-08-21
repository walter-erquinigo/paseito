import { useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import type { MRImportance, MRTrackerSettings, MRTrackerViewState } from "./types";

const QUERY_KEY = ["desktop-mr-tracker"] as const;

export async function loadMRTrackerState(): Promise<MRTrackerViewState> {
  return await invokeDesktopCommand<MRTrackerViewState>("get_mr_tracker_state");
}

export function useMRTrackerState(): {
  state: MRTrackerViewState | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<MRTrackerViewState>;
  addTracked: (prompt: string) => Promise<MRTrackerViewState>;
  removeTracked: (id: string) => Promise<MRTrackerViewState>;
  setImportance: (id: string, importance: MRImportance) => Promise<MRTrackerViewState>;
} {
  const queryClient = useQueryClient();
  const query = useReplicaQuery<MRTrackerViewState, Error>({
    queryKey: QUERY_KEY,
    queryFn: loadMRTrackerState,
    enabled: getIsElectron(),
    retry: false,
    pushEvent: "mr-tracker-state-changed",
  });

  useEffect(() => {
    const on = getDesktopHost()?.events?.on;
    if (!on) return;
    let cleanup: (() => void) | null = null;
    void Promise.resolve(
      on("mr-tracker-state-changed", (payload) => {
        queryClient.setQueryData(QUERY_KEY, payload as MRTrackerViewState);
      }),
    ).then((value) => {
      cleanup = value;
      return;
    });
    return () => cleanup?.();
  }, [queryClient]);

  const run = useCallback(
    async (command: string, args?: Record<string, unknown>) => {
      const state = await invokeDesktopCommand<MRTrackerViewState>(command, args);
      queryClient.setQueryData(QUERY_KEY, state);
      return state;
    },
    [queryClient],
  );
  return {
    state: query.data ?? null,
    isLoading: query.isPending,
    error: query.error,
    refresh: () => run("refresh_mr_tracker"),
    addTracked: (prompt) => run("add_tracked_mr", { prompt }),
    removeTracked: (id) => run("remove_tracked_mr", { id }),
    setImportance: (id, importance) => run("set_mr_importance", { id, importance }),
  };
}

export function useMRTrackerSettingsMutation(): {
  save: (
    settings: Omit<MRTrackerSettings, "refreshIntervalSeconds"> & { accessToken?: string },
  ) => Promise<MRTrackerViewState>;
  clearToken: () => Promise<MRTrackerViewState>;
  isSaving: boolean;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation<MRTrackerViewState, Error, Record<string, unknown>>({
    mutationFn: (args) => invokeDesktopCommand("save_mr_tracker_settings", args),
    onSuccess: (state) => queryClient.setQueryData(QUERY_KEY, state),
  });
  const clearMutation = useMutation<MRTrackerViewState, Error>({
    mutationFn: () => invokeDesktopCommand("clear_mr_tracker_token"),
    onSuccess: (state) => queryClient.setQueryData(QUERY_KEY, state),
  });
  return {
    save: (settings) => mutation.mutateAsync(settings),
    clearToken: () => clearMutation.mutateAsync(),
    isSaving: mutation.isPending || clearMutation.isPending,
    error: mutation.error ?? clearMutation.error,
  };
}
