import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { QueueWriter, QueuedComposerMessage } from "@/composer/actions";

type QueuesByAgent = Record<string, QueuedComposerMessage[]>;

interface ComposerQueueState {
  queuesByServer: Record<string, QueuesByAgent>;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  read: (serverId: string, agentId: string) => QueuedComposerMessage[];
  write: (
    serverId: string,
    value:
      | Map<string, QueuedComposerMessage[]>
      | ((prev: Map<string, QueuedComposerMessage[]>) => Map<string, QueuedComposerMessage[]>),
  ) => void;
  removeServer: (serverId: string) => void;
  rekeyServer: (previousServerId: string, nextServerId: string) => void;
}

function recordToMap(value: QueuesByAgent | undefined): Map<string, QueuedComposerMessage[]> {
  return new Map(Object.entries(value ?? {}));
}

function mapToRecord(value: Map<string, QueuedComposerMessage[]>): QueuesByAgent {
  const result: QueuesByAgent = {};
  for (const [agentId, queue] of value) {
    if (queue.length > 0) result[agentId] = queue;
  }
  return result;
}

export const useComposerQueueStore = create<ComposerQueueState>()(
  persist(
    (set, get) => ({
      queuesByServer: {},
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      read: (serverId, agentId) => get().queuesByServer[serverId]?.[agentId] ?? [],
      write: (serverId, value) => {
        set((state) => {
          const previous = recordToMap(state.queuesByServer[serverId]);
          const next = typeof value === "function" ? value(previous) : value;
          const nextQueues = mapToRecord(next);
          const queuesByServer = { ...state.queuesByServer };
          if (Object.keys(nextQueues).length === 0) delete queuesByServer[serverId];
          else queuesByServer[serverId] = nextQueues;
          return { queuesByServer };
        });
      },
      removeServer: (serverId) => {
        set((state) => {
          if (!state.queuesByServer[serverId]) return state;
          const queuesByServer = { ...state.queuesByServer };
          delete queuesByServer[serverId];
          return { queuesByServer };
        });
      },
      rekeyServer: (previousServerId, nextServerId) => {
        if (previousServerId === nextServerId) return;
        set((state) => {
          const previous = state.queuesByServer[previousServerId];
          if (!previous) return state;
          const queuesByServer = { ...state.queuesByServer };
          queuesByServer[nextServerId] = { ...previous, ...queuesByServer[nextServerId] };
          delete queuesByServer[previousServerId];
          return { queuesByServer };
        });
      },
    }),
    {
      name: "paseito-composer-queues",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ queuesByServer: state.queuesByServer }),
      version: 1,
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);

export function createComposerQueueWriter(serverId: string): QueueWriter {
  return {
    read: (agentId) => useComposerQueueStore.getState().read(serverId, agentId),
    write: (updater) => useComposerQueueStore.getState().write(serverId, updater),
  };
}
