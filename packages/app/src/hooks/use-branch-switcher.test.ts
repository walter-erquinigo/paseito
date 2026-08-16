import { describe, expect, it } from "vitest";
import { includeCurrentBranch, orderBranchSwitcherBranches } from "./use-branch-switcher";

describe("orderBranchSwitcherBranches", () => {
  it("orders preferred-owner branches literally and preserves the remaining host order", () => {
    const branches = [
      "werquinigo/public-debug-info-good-0-typedef",
      "werquinigo/public-debug-info-1-int-ptr",
      "werquinigo/public-debug-info-good-1-int-ptr",
      "werquinigo/public-debug-info-good-2-dsl",
      "werquinigo/automation/tile-debug-20260806-010100",
      "werquinigo/automation/tile-debug-20260805-010059",
      "werquinigo/automation/tile-debug-20260814-010104",
      "werquinigo/automation/tile-debug-20260810-010103",
      "werquinigo/automation/tile-debug-20260813-010105",
      "werquinigo/tile-type-2-debugify",
      "zeta/remote-stack",
      "alpha/recent",
    ];

    expect(orderBranchSwitcherBranches(branches)).toEqual([
      "werquinigo/automation/tile-debug-20260805-010059",
      "werquinigo/automation/tile-debug-20260806-010100",
      "werquinigo/automation/tile-debug-20260810-010103",
      "werquinigo/automation/tile-debug-20260813-010105",
      "werquinigo/automation/tile-debug-20260814-010104",
      "werquinigo/public-debug-info-1-int-ptr",
      "werquinigo/public-debug-info-good-0-typedef",
      "werquinigo/public-debug-info-good-1-int-ptr",
      "werquinigo/public-debug-info-good-2-dsl",
      "werquinigo/tile-type-2-debugify",
      "zeta/remote-stack",
      "alpha/recent",
    ]);
    expect(branches[0]).toBe("werquinigo/public-debug-info-good-0-typedef");
  });
});

describe("includeCurrentBranch", () => {
  it("adds a current branch omitted by the bounded suggestions without duplicating it", () => {
    expect(includeCurrentBranch(["dev"], "main")).toEqual(["dev", "main"]);
    expect(includeCurrentBranch(["main", "dev"], "main")).toEqual(["main", "dev"]);
  });
});
