import type { MergeRequestSnapshot } from "./types";

export type MRActivityState = "no_activity" | "open" | "all_clear";

export type MRActivitySummary = MergeRequestSnapshot["discussions"]["activity"][number];

export function resolveMRActivityState(activity: MRActivitySummary): MRActivityState {
  if (activity.noteCount === 0) return "no_activity";
  return activity.unresolvedCount > 0 ? "open" : "all_clear";
}
