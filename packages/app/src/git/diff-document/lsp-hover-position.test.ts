import { describe, expect, it } from "vitest";
import { positionLspHover } from "./lsp-hover-position";

describe("positionLspHover", () => {
  it("places a hover below and to the right when the viewport has room", () => {
    expect(
      positionLspHover({ anchorX: 100, anchorY: 80, viewportWidth: 900, viewportHeight: 700 }),
    ).toEqual({ left: 112, top: 92, maxWidth: 560, maxHeight: 420 });
  });

  it("flips a hover inside the viewport near the bottom-right corner", () => {
    expect(
      positionLspHover({ anchorX: 880, anchorY: 680, viewportWidth: 900, viewportHeight: 700 }),
    ).toEqual({ right: 32, bottom: 32, maxWidth: 560, maxHeight: 420 });
  });

  it("bounds the card dimensions in a narrow viewport", () => {
    expect(
      positionLspHover({ anchorX: 150, anchorY: 100, viewportWidth: 260, viewportHeight: 180 }),
    ).toEqual({ right: 122, bottom: 92, maxWidth: 130, maxHeight: 80 });
  });
});
