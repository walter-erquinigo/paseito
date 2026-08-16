import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComposerQueueWriter, useComposerQueueStore } from "./queue-store";

vi.mock("@react-native-async-storage/async-storage", () => {
  const values = new Map<string, string>();
  return {
    default: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => void values.set(key, value),
      removeItem: async (key: string) => void values.delete(key),
      clear: async () => void values.clear(),
    },
  };
});

describe("composer queue persistence", () => {
  beforeEach(async () => {
    await useComposerQueueStore.persist.clearStorage();
    useComposerQueueStore.setState({ queuesByServer: {}, hasHydrated: true });
  });

  it("scopes queued messages by host and agent", () => {
    const first = createComposerQueueWriter("server-a");
    const second = createComposerQueueWriter("server-b");
    first.write(
      () => new Map([["agent-1", [{ id: "message-1", text: "queued", attachments: [] }]]]),
    );

    expect(first.read("agent-1")).toHaveLength(1);
    expect(second.read("agent-1")).toEqual([]);
  });

  it("writes queue data through the AsyncStorage persist adapter", async () => {
    createComposerQueueWriter("server-a").write(
      () =>
        new Map([["agent-1", [{ id: "message-1", text: "survives restart", attachments: [] }]]]),
    );

    await vi.waitFor(async () => {
      const serialized = await AsyncStorage.getItem("paseito-composer-queues");
      expect(serialized).toContain("survives restart");
    });
  });
});
