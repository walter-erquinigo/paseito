const HOVER_GAP = 12;
const VIEWPORT_MARGIN = 8;
const PREFERRED_MIN_WIDTH = 280;
const PREFERRED_MIN_HEIGHT = 160;
const MAX_WIDTH = 560;
const MAX_HEIGHT = 420;

export interface LspHoverPosition {
  bottom?: number;
  left?: number;
  maxHeight: number;
  maxWidth: number;
  right?: number;
  top?: number;
}

export function positionLspHover(input: {
  anchorX: number;
  anchorY: number;
  viewportHeight: number;
  viewportWidth: number;
}): LspHoverPosition {
  const { anchorX, anchorY, viewportHeight, viewportWidth } = input;
  const rightSpace = viewportWidth - anchorX - HOVER_GAP - VIEWPORT_MARGIN;
  const leftSpace = anchorX - HOVER_GAP - VIEWPORT_MARGIN;
  const belowSpace = viewportHeight - anchorY - HOVER_GAP - VIEWPORT_MARGIN;
  const aboveSpace = anchorY - HOVER_GAP - VIEWPORT_MARGIN;
  const placeRight = rightSpace >= PREFERRED_MIN_WIDTH || rightSpace >= leftSpace;
  const placeBelow = belowSpace >= PREFERRED_MIN_HEIGHT || belowSpace >= aboveSpace;
  const horizontal = placeRight
    ? {
        left: Math.max(VIEWPORT_MARGIN, anchorX + HOVER_GAP),
        maxWidth: Math.max(1, Math.min(MAX_WIDTH, rightSpace)),
      }
    : {
        right: Math.max(VIEWPORT_MARGIN, viewportWidth - anchorX + HOVER_GAP),
        maxWidth: Math.max(1, Math.min(MAX_WIDTH, leftSpace)),
      };
  const vertical = placeBelow
    ? {
        top: Math.max(VIEWPORT_MARGIN, anchorY + HOVER_GAP),
        maxHeight: Math.max(1, Math.min(MAX_HEIGHT, belowSpace)),
      }
    : {
        bottom: Math.max(VIEWPORT_MARGIN, viewportHeight - anchorY + HOVER_GAP),
        maxHeight: Math.max(1, Math.min(MAX_HEIGHT, aboveSpace)),
      };
  return { ...horizontal, ...vertical };
}
