import { describe, expect, it } from "vitest";
import { resolveMRActivityState, type MRActivitySummary } from "./activity-state";

const user = {
  id: 80,
  username: "group_bot",
  name: "Greptile",
  webUrl: null,
  avatarUrl: null,
};

describe("MR activity state", () => {
  it.each([
    [{ user, noteCount: 0, unresolvedCount: 0 }, "no_activity"],
    [{ user, noteCount: 2, unresolvedCount: 1 }, "open"],
    [{ user, noteCount: 1, unresolvedCount: 0 }, "all_clear"],
  ] satisfies Array<[MRActivitySummary, string]>)("maps %o to %s", (activity, expected) => {
    expect(resolveMRActivityState(activity)).toBe(expected);
  });
});
