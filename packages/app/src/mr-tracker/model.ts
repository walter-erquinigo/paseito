import type { MergeRequestSnapshot, MRTrackerTab } from "./types";
import { resolveMRActivityState } from "./activity-state";

export interface MRStackEntry {
  mergeRequest: MergeRequestSnapshot;
  depth: number;
  context: boolean;
}

export interface MRStack {
  id: string;
  projectPath: string;
  entries: MRStackEntry[];
}

export function filterMRsByImportance(
  mergeRequests: MergeRequestSnapshot[],
  importantOnly: boolean,
): MergeRequestSnapshot[] {
  if (!importantOnly) return mergeRequests;
  return mergeRequests.filter((value) => value.importance === "important");
}

function tabContains(tab: MRTrackerTab, value: MergeRequestSnapshot): boolean {
  if (tab === "all") return true;
  return tab === "my_mrs" ? value.isOwned : !value.isOwned;
}

function searchable(value: MergeRequestSnapshot): string {
  return [
    value.title,
    value.projectPath,
    value.iid,
    value.author.username,
    value.author.name,
    value.sourceBranch,
    value.targetBranch,
    value.importance,
    ...value.discussions.activity.flatMap((activity) => [
      activity.user.name,
      activity.user.username,
      resolveMRActivityState(activity).replaceAll("_", " "),
    ]),
    ...value.labels,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function order(left: MergeRequestSnapshot, right: MergeRequestSnapshot): number {
  return left.iid - right.iid || left.id.localeCompare(right.id);
}

export function buildMRStacks(
  mergeRequests: MergeRequestSnapshot[],
  tab: MRTrackerTab,
  searchText: string,
): MRStack[] {
  const query = searchText.trim().toLowerCase();
  const projects = groupByProject(mergeRequests);
  const result = [...projects.values()].flatMap((values) => buildProjectStacks(values, tab, query));
  return result.sort((left, right) => {
    const a = left.entries[0]?.mergeRequest;
    const b = right.entries[0]?.mergeRequest;
    if (!a || !b) return left.id.localeCompare(right.id);
    return (
      Number(b.needsAttention) - Number(a.needsAttention) ||
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
    );
  });
}

function groupByProject(values: MergeRequestSnapshot[]): Map<number, MergeRequestSnapshot[]> {
  const projects = new Map<number, MergeRequestSnapshot[]>();
  for (const value of values) {
    const projectValues = projects.get(value.projectId) ?? [];
    projectValues.push(value);
    projects.set(value.projectId, projectValues);
  }
  return projects;
}

function buildParents(values: MergeRequestSnapshot[]): Map<string, string> {
  const bySource = new Map<string, MergeRequestSnapshot[]>();
  for (const value of values) {
    const candidates = bySource.get(value.sourceBranch) ?? [];
    candidates.push(value);
    bySource.set(value.sourceBranch, candidates);
  }
  const parents = new Map<string, string>();
  for (const child of values) {
    const parent = bySource.get(child.targetBranch)?.[0];
    if (parent && parent.id !== child.id) parents.set(child.id, parent.id);
  }
  return parents;
}

function breakParentCycles(values: MergeRequestSnapshot[], parents: Map<string, string>): void {
  for (const start of values) {
    const path: string[] = [];
    let current: string | undefined = start.id;
    while (current && !path.includes(current)) {
      path.push(current);
      current = parents.get(current);
    }
    if (!current) continue;
    const cycle = new Set(path.slice(path.indexOf(current)));
    const root = values.filter((value) => cycle.has(value.id)).sort(order)[0];
    if (root) parents.delete(root.id);
  }
}

function groupChildren(
  values: MergeRequestSnapshot[],
  parents: Map<string, string>,
): Map<string, MergeRequestSnapshot[]> {
  const children = new Map<string, MergeRequestSnapshot[]>();
  for (const value of values) {
    const parent = parents.get(value.id);
    if (!parent) continue;
    const entries = children.get(parent) ?? [];
    entries.push(value);
    entries.sort(order);
    children.set(parent, entries);
  }
  return children;
}

function appendStackEntries(
  value: MergeRequestSnapshot,
  depth: number,
  entries: MRStackEntry[],
  children: Map<string, MergeRequestSnapshot[]>,
  tab: MRTrackerTab,
): void {
  entries.push({ mergeRequest: value, depth, context: !tabContains(tab, value) });
  for (const child of children.get(value.id) ?? []) {
    appendStackEntries(child, depth + 1, entries, children, tab);
  }
}

function buildProjectStacks(
  projectValues: MergeRequestSnapshot[],
  tab: MRTrackerTab,
  query: string,
): MRStack[] {
  const values = [...projectValues].sort(order);
  const parents = buildParents(values);
  breakParentCycles(values, parents);
  const children = groupChildren(values, parents);
  const result: MRStack[] = [];
  for (const root of values.filter((value) => !parents.has(value.id))) {
    const entries: MRStackEntry[] = [];
    appendStackEntries(root, 0, entries, children, tab);
    if (!entries.some((entry) => tabContains(tab, entry.mergeRequest))) continue;
    if (query && !entries.some((entry) => searchable(entry.mergeRequest).includes(query))) continue;
    result.push({ id: `stack:${root.id}`, projectPath: root.projectPath, entries });
  }
  return result;
}
