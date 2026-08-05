import { describe, expect, it } from "vitest";
import {
  buildChangesBaseOptions,
  buildChangesBaseScopeKey,
  CHANGES_BASE_OVERRIDES_STORAGE_KEY,
  loadChangesBaseOverrides,
  persistChangesBaseOverrides,
} from "./changes-base-selection";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("Changes base selection", () => {
  it("pins the recorded base, includes local and origin refs, and excludes HEAD", () => {
    expect(
      buildChangesBaseOptions({
        currentBranch: "feature/current",
        recordedBaseRef: "develop",
        branches: [
          { name: "feature/current", hasLocal: true, hasRemote: true },
          { name: "main", hasLocal: true, hasRemote: true },
          { name: "develop", hasLocal: true, hasRemote: false },
          { name: "release", hasLocal: false, hasRemote: true },
        ],
      }).map((option) => option.id),
    ).toEqual(["develop", "refs/heads/main", "origin/main", "origin/release"]);
  });

  it("keeps overrides isolated by repository root and current branch", () => {
    expect(buildChangesBaseScopeKey("/repo", "feature/a")).not.toBe(
      buildChangesBaseScopeKey("/repo", "feature/b"),
    );
    expect(buildChangesBaseScopeKey("/repo-a", "feature/a")).not.toBe(
      buildChangesBaseScopeKey("/repo-b", "feature/a"),
    );
  });

  it("round-trips overrides and fails closed on corrupt storage", async () => {
    const storage = createStorage();
    const overrides = { [buildChangesBaseScopeKey("/repo", "feature")]: "origin/main" };
    await persistChangesBaseOverrides(storage, overrides);
    await expect(loadChangesBaseOverrides(storage)).resolves.toEqual(overrides);

    const corrupt = createStorage({ [CHANGES_BASE_OVERRIDES_STORAGE_KEY]: "not json" });
    await expect(loadChangesBaseOverrides(corrupt)).resolves.toEqual({});
  });
});
