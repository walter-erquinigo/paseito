import { useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { invalidateCheckoutComparisonQueriesForClient } from "./query-keys";
import {
  buildChangesBaseScopeKey,
  loadChangesBaseOverrides,
  persistChangesBaseOverrides,
} from "./changes-base-selection";

const CHANGES_BASE_OVERRIDES_QUERY_KEY = ["changes-base-overrides"] as const;

interface UseChangesBaseSelectionInput {
  serverId: string;
  cwd: string;
  repoRoot: string | null | undefined;
  currentBranch: string | null;
  recordedBaseRef: string | undefined;
}

export function useChangesBaseSelection(input: UseChangesBaseSelectionInput) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  // COMPAT(changesBaseSelector): added in Paseito v0.2.5-paseito.1, remove after 2027-02-04.
  const supported = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.changesBaseSelector === true,
  );
  const overridesQuery = useFetchQuery({
    queryKey: CHANGES_BASE_OVERRIDES_QUERY_KEY,
    queryFn: () => loadChangesBaseOverrides(AsyncStorage),
    staleTimeMs: 60_000,
    dataShape: "value",
    gcTime: Infinity,
  });
  const scopeKey = useMemo(
    () =>
      input.repoRoot && input.currentBranch
        ? buildChangesBaseScopeKey(input.repoRoot, input.currentBranch)
        : null,
    [input.currentBranch, input.repoRoot],
  );
  const override = scopeKey ? (overridesQuery.data?.[scopeKey] ?? null) : null;
  const validationQuery = useFetchQuery({
    queryKey: ["changesBaseValidation", input.serverId, input.cwd, override],
    queryFn: async () => {
      if (!client || !override) {
        return null;
      }
      const result = await client.validateBranch({ cwd: input.cwd, branchName: override });
      if (result.error) {
        throw new Error(result.error);
      }
      return result.exists;
    },
    enabled: supported && isConnected && Boolean(client && override),
    retry: false,
    staleTimeMs: 5_000,
    dataShape: "value",
  });

  const setOverride = useCallback(
    async (baseRef: string | null) => {
      if (!scopeKey) {
        return;
      }
      const previous =
        queryClient.getQueryData<Record<string, string>>(CHANGES_BASE_OVERRIDES_QUERY_KEY) ?? {};
      const next = { ...previous };
      if (!baseRef || baseRef === input.recordedBaseRef) {
        delete next[scopeKey];
      } else {
        next[scopeKey] = baseRef;
        queryClient.setQueryData(
          ["changesBaseValidation", input.serverId, input.cwd, baseRef],
          true,
        );
      }
      queryClient.setQueryData(CHANGES_BASE_OVERRIDES_QUERY_KEY, next);
      await invalidateCheckoutComparisonQueriesForClient(queryClient, {
        serverId: input.serverId,
        cwd: input.cwd,
      });
      await persistChangesBaseOverrides(AsyncStorage, next);
    },
    [input.cwd, input.recordedBaseRef, input.serverId, queryClient, scopeKey],
  );

  useEffect(() => {
    if (override && validationQuery.data === false) {
      void setOverride(null);
    }
  }, [override, setOverride, validationQuery.data]);

  const effectiveBaseRef =
    supported && override && validationQuery.data === true ? override : input.recordedBaseRef;

  return {
    supported,
    effectiveBaseRef,
    recordedBaseRef: input.recordedBaseRef,
    selectedBaseRef: override,
    setOverride,
  };
}
