import { describe, expect, it } from "vitest";
import { reviewCheckboxVisibility } from "./review-checkbox-model";

describe("reviewCheckboxVisibility", () => {
  it("keeps reviewed and mixed states visible", () => {
    expect(reviewCheckboxVisibility({ state: "reviewed" })).toBe(true);
    expect(reviewCheckboxVisibility({ state: "mixed" })).toBe(true);
  });

  it("reveals an unreviewed control only through an available interaction path", () => {
    expect(reviewCheckboxVisibility({ state: "unreviewed" })).toBe(false);
    expect(reviewCheckboxVisibility({ state: "unreviewed", hovered: true })).toBe(true);
    expect(reviewCheckboxVisibility({ state: "unreviewed", focused: true })).toBe(true);
    expect(reviewCheckboxVisibility({ state: "unreviewed", selected: true })).toBe(true);
    expect(reviewCheckboxVisibility({ state: "unreviewed", alwaysVisible: true })).toBe(true);
  });
});
