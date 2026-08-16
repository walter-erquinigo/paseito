import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFileReviewScopeKey,
  getFileReviewSnapshot,
  markFileReviewsInState,
  observeFileReviewsInState,
  unmarkFileReviewsInState,
  useFileReviewStore,
} from "./file-review";

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

const REVIEWED_AT = "2026-08-07T18:00:00.000Z";

describe("file review state", () => {
  beforeEach(async () => {
    await useFileReviewStore.persist.clearStorage();
    useFileReviewStore.setState({ recordsByScope: {} });
  });

  it("scopes reviews by host, main repository, and branch only", () => {
    const key = buildFileReviewScopeKey({
      serverId: " viking-new ",
      repositoryRoot: "/repo/main/",
      branch: " werquinigo/feature ",
    });

    expect(key).toBe(
      "file-review:server=viking-new:repository=%2Frepo%2Fmain:branch=werquinigo%2Ffeature",
    );
  });

  it("keeps identical content reviewed and invalidates each newly observed revision", () => {
    const scopeKey = "scope";
    const marked = markFileReviewsInState(
      {},
      {
        scopeKey,
        files: [{ path: "src/a.ts", contentRevision: "revision-1" }],
        reviewedAt: REVIEWED_AT,
      },
    );
    expect(
      getFileReviewSnapshot(marked[scopeKey] ?? {}, [
        { path: "src/a.ts", contentRevision: "revision-1" },
      ]),
    ).toMatchObject({ reviewedCount: 1, invalidatedPaths: [] });

    const changedFiles = [{ path: "src/a.ts", contentRevision: "revision-2" }];
    expect(getFileReviewSnapshot(marked[scopeKey] ?? {}, changedFiles)).toMatchObject({
      reviewedCount: 0,
      invalidatedPaths: ["src/a.ts"],
    });
    const observed = observeFileReviewsInState(marked, { scopeKey, files: changedFiles });
    expect(getFileReviewSnapshot(observed[scopeKey] ?? {}, changedFiles).invalidatedPaths).toEqual(
      [],
    );
    expect(
      getFileReviewSnapshot(observed[scopeKey] ?? {}, [
        { path: "src/a.ts", contentRevision: "revision-1" },
      ]).reviewedCount,
    ).toBe(1);
  });

  it("resets renamed paths and removes explicit unreviews", () => {
    const scopeKey = "scope";
    const marked = markFileReviewsInState(
      {},
      {
        scopeKey,
        files: [{ path: "src/old.ts", contentRevision: "revision-1" }],
        reviewedAt: REVIEWED_AT,
      },
    );
    const renamed = getFileReviewSnapshot(marked[scopeKey] ?? {}, [
      { path: "src/new.ts", contentRevision: "revision-1" },
    ]);
    expect(renamed).toMatchObject({ reviewedCount: 0, invalidatedPaths: [] });
    expect(unmarkFileReviewsInState(marked, { scopeKey, paths: ["src/old.ts"] })).toEqual({});
  });

  it("persists reviewed content through the AsyncStorage adapter", async () => {
    useFileReviewStore.getState().mark({
      scopeKey: "scope",
      files: [{ path: "src/a.ts", contentRevision: "revision-1" }],
      reviewedAt: REVIEWED_AT,
    });

    await vi.waitFor(async () => {
      const serialized = await AsyncStorage.getItem("@paseo:file-review-store");
      expect(serialized).toContain('"reviewedRevision":"revision-1"');
    });
  });

  it("persists line review fingerprints through the existing local store", async () => {
    useFileReviewStore.getState().replaceRecords({
      scope: {
        "src/a.ts": {
          reviewedRevision: "",
          lastSeenRevision: "revision-2",
          reviewedAt: REVIEWED_AT,
          reviewedLines: [{ fingerprint: '["new","add","+value","",""]', occurrence: 0 }],
          lastSeenDiffSignature: "signature-2",
          lastSeenFingerprintCounts: { '["new","add","+value","",""]': 1 },
        },
      },
    });

    await vi.waitFor(async () => {
      const serialized = await AsyncStorage.getItem("@paseo:file-review-store");
      expect(serialized).toContain('"reviewedLines"');
      expect(serialized).toContain('\\\"+value\\\"');
      expect(serialized).toContain('"lastSeenDiffSignature":"signature-2"');
    });
  });
});
