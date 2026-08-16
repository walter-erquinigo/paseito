export const DIFF_CONTEXT_CONTROL_HEIGHT = 28;
const SMALL_CONTEXT_REGION_THRESHOLD = 40;
const MAX_CONTEXT_EXPANSION_LINES = 5_000;
const CONTEXT_EDGE_EXPANSION_LINES = 20;
const contextLineCountFormat = new Intl.NumberFormat("en-US");

type ContextControlPresentation =
  | { kind: "small"; allCount: number; allLabel: string }
  | { kind: "large"; edgeCount: number; allCount: number; allLabel: string };

export function contextControlPresentation(lineCount: number): ContextControlPresentation {
  const allCount = Math.min(lineCount, MAX_CONTEXT_EXPANSION_LINES);
  if (lineCount <= SMALL_CONTEXT_REGION_THRESHOLD) {
    return {
      kind: "small",
      allCount,
      allLabel: `Show ${contextLineCountFormat.format(lineCount)} unchanged lines`,
    };
  }
  return {
    kind: "large",
    edgeCount: CONTEXT_EDGE_EXPANSION_LINES,
    allCount,
    allLabel:
      lineCount > MAX_CONTEXT_EXPANSION_LINES
        ? `Show ${contextLineCountFormat.format(MAX_CONTEXT_EXPANSION_LINES)} of ${contextLineCountFormat.format(lineCount)} unchanged lines`
        : `Show all ${contextLineCountFormat.format(lineCount)} unchanged lines`,
  };
}
