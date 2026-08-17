import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { openWorkspaceFileFromExplorer } from "@/screens/workspace/workspace-file-open-command";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openTabInSidePanel } from "@/workspace-tabs/side-panel";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import { isAbsolutePath } from "@/utils/path";
import {
  createWorkingDiffFileNavigationTarget,
  waitForWorkingDiffNavigationSnapshot,
  waitForInlineWorkingDiffNavigationSnapshot,
} from "@/workspace/markdown-changes-navigation";
import {
  describeWorkspaceFilePath,
  resolveUnsupportedFileSearchHost,
  type UnsupportedFileSearchHost,
  type WorkspaceFileSearchEntry,
} from "./workspace-file-search-model";

interface DirectorySuggestionEntry {
  path: string;
}

const FILE_SEARCH_DEBOUNCE_MS = 100;
const FILE_SEARCH_LIMIT = 100;

interface WorkspaceFileSearchState {
  sourceKey: string | null;
  requestKey: string | null;
  entries: readonly WorkspaceFileSearchEntry[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: WorkspaceFileSearchState = {
  sourceKey: null,
  requestKey: null,
  entries: [],
  loading: false,
  error: null,
};

export function useWorkspaceFileSearchWarmup(): void {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const client = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.client ?? null) : null,
  );
  const supportsWorkspaceFileSearch = useSessionStore(
    (state) =>
      (serverId ? state.sessions[serverId]?.serverInfo?.features?.workspaceFileSearch : false) ===
      true,
  );

  useEffect(() => {
    if (!client || !cwd || !supportsWorkspaceFileSearch) return;
    void client
      .getDirectorySuggestions({
        cwd,
        query: "",
        includeFiles: true,
        includeDirectories: false,
        matchMode: "fuzzy",
        prepareOnly: true,
        limit: FILE_SEARCH_LIMIT,
      })
      .catch(() => undefined);
  }, [client, cwd, supportsWorkspaceFileSearch]);
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name !== "DaemonRpcError") return error.message;
  return error.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

function describeFileEntries(
  entries: readonly DirectorySuggestionEntry[],
): WorkspaceFileSearchEntry[] {
  return entries.map(({ path }) => describeWorkspaceFilePath(path));
}

export function useWorkspaceFileSearch(input: { enabled: boolean; query: string }): {
  entries: readonly WorkspaceFileSearchEntry[];
  loading: boolean;
  error: string | null;
  unsupportedHost: UnsupportedFileSearchHost;
  openFile(path: string): void;
  openFileInChanges(path: string): Promise<"opened" | "absent">;
} {
  const selection = useActiveWorkspaceSelection();
  const isCompact = useIsCompactFormFactor();
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const client = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.client ?? null) : null,
  );
  const serverInfo = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.serverInfo ?? null) : null,
  );
  // COMPAT(workspaceFileSearch): added in Paseito v0.4.0-paseito.20, remove after 2027-02-17.
  const supportsWorkspaceFileSearch = serverInfo?.features?.workspaceFileSearch === true;
  // COMPAT(workspaceFileSearchAbsolutePaths): added in Paseito v0.4.0-paseito.32,
  // remove after 2027-02-21.
  const supportsAbsolutePathSearch =
    serverInfo?.features?.workspaceFileSearchAbsolutePaths === true;
  const searchesAbsolutePath = isAbsolutePath(input.query.trim());
  const supportsCurrentSearch =
    supportsWorkspaceFileSearch && (!searchesAbsolutePath || supportsAbsolutePathSearch);
  const unsupportedHost = resolveUnsupportedFileSearchHost({
    hostAvailable: Boolean(client && cwd && serverInfo),
    supportsWorkspaceFileSearch,
    searchesAbsolutePath,
    supportsAbsolutePathSearch,
  });
  const [state, setState] = useState<WorkspaceFileSearchState>(EMPTY_STATE);
  const sourceKey = useMemo(
    () => (serverId && workspaceId && cwd && client ? `${serverId}\0${workspaceId}\0${cwd}` : null),
    [client, cwd, serverId, workspaceId],
  );
  const requestKey = useMemo(
    () =>
      input.enabled && supportsCurrentSearch && sourceKey ? `${sourceKey}\0${input.query}` : null,
    [input.enabled, input.query, sourceKey, supportsCurrentSearch],
  );

  useEffect(() => {
    if (!requestKey || !client || !cwd) {
      setState(EMPTY_STATE);
      return;
    }
    const activeClient = client;
    const activeCwd = cwd;

    let cancelled = false;
    setState((previous) => ({
      sourceKey,
      requestKey,
      entries: previous.sourceKey === sourceKey ? previous.entries : [],
      loading: true,
      error: null,
    }));
    async function search(): Promise<void> {
      try {
        const payload = await activeClient.getDirectorySuggestions({
          cwd: activeCwd,
          query: input.query,
          filesystemPath: searchesAbsolutePath,
          includeFiles: true,
          includeDirectories: false,
          limit: FILE_SEARCH_LIMIT,
        });
        if (cancelled) return;
        setState({
          sourceKey,
          requestKey,
          entries: payload.error ? [] : describeFileEntries(payload.entries),
          loading: false,
          error: payload.error ?? null,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            sourceKey,
            requestKey,
            entries: [],
            loading: false,
            error: errorMessage(error),
          });
        }
      }
    }

    const timer = setTimeout(() => void search(), input.query.trim() ? FILE_SEARCH_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, input.query, requestKey, searchesAbsolutePath, sourceKey]);

  const openFile = useCallback(
    (path: string) => {
      if (!serverId || !workspaceId) return;
      clearCommandCenterFocusRestoreElement();
      openWorkspaceFileFromExplorer({
        filePath: path,
        persistenceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
        closeExplorerAfterOpen: true,
        showMobileAgent: usePanelStore.getState().showMobileAgent,
        openWorkspaceTabInFocusedPane: (workspaceKey, target, placement) =>
          useWorkspaceLayoutStore.getState().openTab({
            workspaceKey,
            target,
            intent: "reveal",
            placement,
          }),
        focusWorkspaceTab: useWorkspaceLayoutStore.getState().focusTab,
      });
    },
    [serverId, workspaceId],
  );

  const openFileInChanges = useCallback(
    async (path: string): Promise<"opened" | "absent"> => {
      if (!serverId || !workspaceId || !cwd) {
        throw new Error("The workspace is unavailable.");
      }
      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (!workspaceKey) {
        throw new Error("The workspace is unavailable.");
      }
      const changesPath = resolveWorkspaceFilePaths({ path, workspaceRoot: cwd })?.relativePath;
      if (!changesPath) {
        return "absent";
      }
      const panelStore = usePanelStore.getState();
      const checkout = { serverId, cwd, isGit: true };
      if (isCompact) {
        panelStore.setExplorerTabForCheckout({ ...checkout, tab: "changes" });
        panelStore.openCompactFileExplorer(checkout);
        const snapshot = await waitForInlineWorkingDiffNavigationSnapshot({ workspaceKey });
        if (!snapshot.files.some((file) => file.path === changesPath)) {
          return "absent";
        }
        clearCommandCenterFocusRestoreElement();
        snapshot.navigate(
          createWorkingDiffFileNavigationTarget({
            current: { kind: "working_diff" },
            path: changesPath,
          }),
        );
        return "opened";
      }
      const tabId = openTabInSidePanel({
        isCompact: false,
        workspaceKey,
        checkout,
        target: { kind: "working_diff" },
      });
      if (!tabId) throw new Error("Changes could not be opened.");
      const snapshot = await waitForWorkingDiffNavigationSnapshot({ workspaceKey, tabId });
      if (!snapshot.files.some((file) => file.path === changesPath)) return "absent";
      clearCommandCenterFocusRestoreElement();
      openTabInSidePanel({
        isCompact: false,
        workspaceKey,
        checkout,
        target: createWorkingDiffFileNavigationTarget({
          current: { kind: "working_diff" },
          path: changesPath,
        }),
      });
      return "opened";
    },
    [cwd, isCompact, serverId, workspaceId],
  );

  return {
    entries: requestKey && state.sourceKey === sourceKey ? state.entries : [],
    loading: Boolean(requestKey) && (state.requestKey !== requestKey || state.loading),
    error: state.requestKey === requestKey ? state.error : null,
    unsupportedHost,
    openFile,
    openFileInChanges,
  };
}
