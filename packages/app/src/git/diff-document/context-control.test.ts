import { describe, expect, it } from "vitest";
import { contextControlPresentation } from "./context-control-model";

describe("contextControlPresentation", () => {
  it("uses one reveal action for small omitted regions", () => {
    expect(contextControlPresentation(40)).toEqual({
      kind: "small",
      allCount: 40,
      allLabel: "Show 40 unchanged lines",
    });
  });

  it("keeps directional controls for larger omitted regions", () => {
    expect(contextControlPresentation(41)).toEqual({
      kind: "large",
      edgeCount: 20,
      allCount: 41,
      allLabel: "Show all 41 unchanged lines",
    });
  });

  it("describes the bounded reveal when more than 5,000 lines are omitted", () => {
    expect(contextControlPresentation(8_000)).toEqual({
      kind: "large",
      edgeCount: 20,
      allCount: 5_000,
      allLabel: "Show 5,000 of 8,000 unchanged lines",
    });
  });
});
