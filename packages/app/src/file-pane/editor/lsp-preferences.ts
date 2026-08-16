import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "paseito.workspace-lsp.v1";

export type WorkspaceLspLanguage = "cpp" | "python";

interface WorkspacePreference {
  enabled: boolean;
  formatOnSave: Partial<Record<WorkspaceLspLanguage, boolean>>;
}

interface PreferenceSnapshot {
  hydrated: boolean;
  workspaces: Record<string, WorkspacePreference>;
}

let snapshot: PreferenceSnapshot = { hydrated: false, workspaces: {} };
let hydration: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function emit(next: PreferenceSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function workspaceKey(serverId: string, cwd: string): string {
  return `${serverId}\u0000${cwd}`;
}

function hydrate(): Promise<void> {
  if (hydration) return hydration;
  hydration = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { workspaces?: unknown };
      if (parsed.workspaces && typeof parsed.workspaces === "object") {
        snapshot = {
          hydrated: false,
          workspaces: normalizeWorkspaces(parsed.workspaces),
        };
      }
      return undefined;
    })
    .catch(() => undefined)
    .finally(() => emit({ ...snapshot, hydrated: true }));
  return hydration;
}

function normalizeWorkspaces(value: object): Record<string, WorkspacePreference> {
  const normalized: Record<string, WorkspacePreference> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as { enabled?: unknown; formatOnSave?: unknown };
    const formatting =
      raw.formatOnSave && typeof raw.formatOnSave === "object"
        ? (raw.formatOnSave as Record<string, unknown>)
        : {};
    normalized[key] = {
      enabled: raw.enabled === true,
      formatOnSave: {
        cpp: formatting.cpp === true,
        python: formatting.python === true,
      },
    };
  }
  return normalized;
}

function persist(next: PreferenceSnapshot): void {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ workspaces: next.workspaces })));
}

function updateWorkspace(
  serverId: string,
  cwd: string,
  update: (current: WorkspacePreference) => WorkspacePreference,
): void {
  const key = workspaceKey(serverId, cwd);
  const current = snapshot.workspaces[key] ?? {
    enabled: false,
    formatOnSave: {},
  };
  const next = {
    ...snapshot,
    workspaces: { ...snapshot.workspaces, [key]: update(current) },
  };
  emit(next);
  persist(next);
}

export function lspLanguageForFile(filename: string): WorkspaceLspLanguage | null {
  const extension = filename.toLowerCase().split(".").at(-1);
  if (["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"].includes(extension ?? "")) {
    return "cpp";
  }
  return extension === "py" || extension === "pyi" ? "python" : null;
}

export function useWorkspaceLspPreferences(input: {
  serverId: string;
  cwd: string;
  language: WorkspaceLspLanguage | null;
}): {
  hydrated: boolean;
  enabled: boolean;
  formatOnSave: boolean;
  setEnabled(enabled: boolean): void;
  setFormatOnSave(enabled: boolean): void;
} {
  useEffect(() => void hydrate(), []);
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
  const preference = current.workspaces[workspaceKey(input.serverId, input.cwd)];
  const setEnabled = useCallback(
    (enabled: boolean) =>
      updateWorkspace(input.serverId, input.cwd, (value) => ({
        ...value,
        enabled,
      })),
    [input.cwd, input.serverId],
  );
  const setFormatOnSave = useCallback(
    (enabled: boolean) => {
      if (!input.language) return;
      updateWorkspace(input.serverId, input.cwd, (value) => ({
        ...value,
        formatOnSave: {
          ...value.formatOnSave,
          [input.language as WorkspaceLspLanguage]: enabled,
        },
      }));
    },
    [input.cwd, input.language, input.serverId],
  );
  return {
    hydrated: current.hydrated,
    enabled: preference?.enabled === true,
    formatOnSave: Boolean(input.language && preference?.formatOnSave[input.language] === true),
    setEnabled,
    setFormatOnSave,
  };
}
