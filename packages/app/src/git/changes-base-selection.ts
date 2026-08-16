import { z } from "zod";
import type { CheckoutStackParent } from "@getpaseo/protocol/messages";
import type { ComboboxOption } from "@/components/ui/combobox";

export const CHANGES_BASE_OVERRIDES_STORAGE_KEY = "@paseito:changes-base-overrides-v1";

const changesBaseOverridesSchema = z.record(z.string(), z.string());

export interface ChangesBaseStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ChangesBaseBranchDetail {
  name: string;
  hasLocal?: boolean;
  hasRemote?: boolean;
}

export type ChangesBaseSource = "override" | "stack-parent" | "recorded";

export function getChangesStackParentBadgeKind(
  status: CheckoutStackParent | null | undefined,
): "malformed" | "missing" | null {
  return status?.state === "malformed" || status?.state === "missing" ? status.state : null;
}

export function resolveChangesBaseRef(input: {
  recordedBaseRef: string | undefined;
  stackParentRef: string | null;
  override: string | null;
  overrideValid: boolean;
}): {
  defaultBaseRef: string | undefined;
  effectiveBaseRef: string | undefined;
  source: ChangesBaseSource;
} {
  const defaultBaseRef = input.stackParentRef ?? input.recordedBaseRef;
  if (input.override && input.overrideValid) {
    return { defaultBaseRef, effectiveBaseRef: input.override, source: "override" };
  }
  if (input.stackParentRef) {
    return {
      defaultBaseRef,
      effectiveBaseRef: input.stackParentRef,
      source: "stack-parent",
    };
  }
  return { defaultBaseRef, effectiveBaseRef: input.recordedBaseRef, source: "recorded" };
}

export async function applyChangesBaseSelection(input: {
  baseRef: string | null;
  setOverride: (baseRef: string | null) => Promise<void>;
  showCommitted: () => void;
}): Promise<void> {
  await input.setOverride(input.baseRef);
  input.showCommitted();
}

export function buildChangesBaseScopeKey(repoRoot: string, currentBranch: string): string {
  return JSON.stringify([repoRoot, currentBranch]);
}

export function normalizeChangesBaseRef(ref: string | null | undefined): string | null {
  const trimmed = ref?.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }
  if (trimmed.startsWith("refs/remotes/")) {
    return trimmed.slice("refs/remotes/".length);
  }
  return trimmed;
}

export function displayChangesBaseRef(ref: string | null | undefined): string | null {
  return normalizeChangesBaseRef(ref)?.replace(/^refs\/heads\//, "") ?? null;
}

export function buildChangesBaseOptions(input: {
  branches: ChangesBaseBranchDetail[];
  defaultBaseRef?: string | null;
  recordedBaseRef?: string | null;
  selectedBaseRef?: string | null;
  currentBranch?: string | null;
}): ComboboxOption[] {
  const currentBranch = displayChangesBaseRef(input.currentBranch)?.replace(/^origin\//, "");
  const recordedBaseRef = normalizeChangesBaseRef(input.recordedBaseRef);
  const recordedDisplayName = displayChangesBaseRef(recordedBaseRef)?.replace(/^origin\//, "");
  const seen = new Set<string>();
  const result: ComboboxOption[] = [];
  const add = (ref: string | null | undefined, label?: string) => {
    const normalized = normalizeChangesBaseRef(ref);
    const displayName = displayChangesBaseRef(normalized);
    if (
      !normalized ||
      displayName === currentBranch ||
      displayName === `origin/${currentBranch}` ||
      seen.has(normalized)
    ) {
      return;
    }
    seen.add(normalized);
    result.push({ id: normalized, label: label ?? displayName ?? normalized });
  };

  add(input.defaultBaseRef);
  add(input.recordedBaseRef);
  add(input.selectedBaseRef);
  for (const branch of input.branches) {
    const name = normalizeChangesBaseRef(branch.name)?.replace(/^origin\//, "");
    if (!name) {
      continue;
    }
    if (
      (branch.hasLocal === true ||
        (branch.hasLocal === undefined && branch.hasRemote === undefined)) &&
      name !== recordedDisplayName
    ) {
      add(`refs/heads/${name}`, name);
    }
    if (branch.hasRemote === true) {
      add(`origin/${name}`);
    }
  }
  return result;
}

export async function loadChangesBaseOverrides(
  storage: ChangesBaseStorage,
): Promise<Record<string, string>> {
  const value = await storage.getItem(CHANGES_BASE_OVERRIDES_STORAGE_KEY);
  if (!value) {
    return {};
  }
  try {
    const parsed = changesBaseOverridesSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function persistChangesBaseOverrides(
  storage: ChangesBaseStorage,
  overrides: Record<string, string>,
): Promise<void> {
  await storage.setItem(CHANGES_BASE_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
}
