export type ReviewDraftMode = "uncommitted" | "base";
export type ReviewDraftSide = "old" | "new";

export interface ReviewDraftComment {
  id: string;
  filePath: string;
  side: ReviewDraftSide;
  lineNumber: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDraftSuggestion {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  originalLines: string[];
  replacement: string;
  note: string;
  sourceRevision: string;
  createdAt: string;
  updatedAt: string;
}

// A manual mode selection is valid only while the checkout's dirty state matches the
// value at the time of selection. serverId/cwd identify the checkout so the override can
// be expired when its dirty state changes (see expireStaleDiffModeOverridesInState).
export interface DiffModeOverride {
  serverId: string;
  cwd: string;
  mode: ReviewDraftMode;
  isDirtyAtSelection: boolean;
}

export interface ReviewDraftStoreState {
  drafts: Record<string, ReviewDraftComment[]>;
  suggestions: Record<string, ReviewDraftSuggestion[]>;
  // In-memory only — not persisted. Keyed by scope key.
  diffModeOverrides: Record<string, DiffModeOverride>;
}

// Only drafts are persisted; diffModeOverrides is intentionally excluded.
export interface SerializedReviewDraftState {
  drafts: Record<string, ReviewDraftComment[]>;
  suggestions: Record<string, ReviewDraftSuggestion[]>;
}

export function setDiffModeOverrideInState(
  state: ReviewDraftStoreState,
  input: { scopeKey: string; override: DiffModeOverride },
): ReviewDraftStoreState {
  return {
    ...state,
    diffModeOverrides: {
      ...state.diffModeOverrides,
      [input.scopeKey]: input.override,
    },
  };
}

// Drops every override for the checkout whose dirty state no longer matches the value it
// was selected under. Called whenever a checkout status enters the app (push or fetch),
// so expiry does not depend on any screen being mounted.
export function expireStaleDiffModeOverridesInState(
  state: ReviewDraftStoreState,
  input: { serverId: string; cwd: string; isDirty: boolean },
): ReviewDraftStoreState {
  const staleScopeKeys = Object.entries(state.diffModeOverrides)
    .filter(
      ([, override]) =>
        override.serverId === input.serverId &&
        override.cwd === input.cwd &&
        override.isDirtyAtSelection !== input.isDirty,
    )
    .map(([scopeKey]) => scopeKey);
  if (staleScopeKeys.length === 0) {
    return state;
  }
  const next = { ...state.diffModeOverrides };
  for (const scopeKey of staleScopeKeys) {
    delete next[scopeKey];
  }
  return { ...state, diffModeOverrides: next };
}

// Pure read — returns the effective mode without mutating state. The staleness check is
// kept even though stale overrides are expired at the data boundary: a render can observe
// a fresh dirty state before the expiry lands, and resolution must be correct under any
// interleaving.
export function resolveDiffMode(input: {
  override: DiffModeOverride | undefined;
  hasUncommittedChanges: boolean;
  hasCommittedChanges: boolean;
}): ReviewDraftMode {
  const { override, hasUncommittedChanges, hasCommittedChanges } = input;
  if (override && override.isDirtyAtSelection === hasUncommittedChanges) {
    return override.mode;
  }
  if (hasCommittedChanges) {
    return "base";
  }
  return hasUncommittedChanges ? "uncommitted" : "base";
}

export function addCommentToState(
  state: ReviewDraftStoreState,
  input: { key: string; comment: ReviewDraftComment },
): ReviewDraftStoreState {
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: [...(state.drafts[input.key] ?? []), input.comment],
    },
  };
}

export function updateCommentInState(
  state: ReviewDraftStoreState,
  input: {
    key: string;
    id: string;
    updates: Partial<Pick<ReviewDraftComment, "body">>;
    updatedAt: string;
  },
): ReviewDraftStoreState {
  const comments = state.drafts[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: comments.map((comment) =>
        applyCommentUpdates(comment, input.id, input.updates, input.updatedAt),
      ),
    },
  };
}

export function deleteCommentFromState(
  state: ReviewDraftStoreState,
  input: { key: string; id: string },
): ReviewDraftStoreState {
  const comments = state.drafts[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: comments.filter((comment) => comment.id !== input.id),
    },
  };
}

export function clearReviewInState(
  state: ReviewDraftStoreState,
  input: { key: string },
): ReviewDraftStoreState {
  if (!state.drafts[input.key] && !state.suggestions[input.key]) {
    return state;
  }
  const nextDrafts = { ...state.drafts };
  const nextSuggestions = { ...state.suggestions };
  delete nextDrafts[input.key];
  delete nextSuggestions[input.key];
  return { ...state, drafts: nextDrafts, suggestions: nextSuggestions };
}

export function serializeReviewDraftState(
  state: ReviewDraftStoreState,
): SerializedReviewDraftState {
  return {
    drafts: state.drafts,
    suggestions: state.suggestions,
  };
}

export function normalizePersistedState(state: unknown): ReviewDraftStoreState {
  if (!state || typeof state !== "object") {
    return { drafts: {}, suggestions: {}, diffModeOverrides: {} };
  }
  // activeModesByScope may be present in old persisted JSON — tolerate and ignore it.
  const persisted = state as { drafts?: unknown; suggestions?: unknown };
  const drafts = persisted.drafts;
  if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) {
    return { drafts: {}, suggestions: {}, diffModeOverrides: {} };
  }

  const normalized: Record<string, ReviewDraftComment[]> = {};
  for (const [key, value] of Object.entries(drafts)) {
    if (!Array.isArray(value)) {
      continue;
    }
    normalized[key] = value.filter((comment): comment is ReviewDraftComment =>
      isReviewDraftComment(comment),
    );
  }

  const suggestions: Record<string, ReviewDraftSuggestion[]> = {};
  if (
    persisted.suggestions &&
    typeof persisted.suggestions === "object" &&
    !Array.isArray(persisted.suggestions)
  ) {
    for (const [key, value] of Object.entries(persisted.suggestions)) {
      if (Array.isArray(value)) {
        suggestions[key] = value.filter((item): item is ReviewDraftSuggestion =>
          isReviewDraftSuggestion(item),
        );
      }
    }
  }

  return { drafts: normalized, suggestions, diffModeOverrides: {} };
}

export function isReviewDraftComment(value: unknown): value is ReviewDraftComment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.filePath === "string" &&
    (record.side === "old" || record.side === "new") &&
    typeof record.lineNumber === "number" &&
    Number.isInteger(record.lineNumber) &&
    record.lineNumber > 0 &&
    typeof record.body === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

export function isReviewDraftSuggestion(value: unknown): value is ReviewDraftSuggestion {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.filePath === "string" &&
    typeof record.startLine === "number" &&
    Number.isInteger(record.startLine) &&
    record.startLine > 0 &&
    typeof record.endLine === "number" &&
    Number.isInteger(record.endLine) &&
    record.endLine >= record.startLine &&
    record.endLine - record.startLine < 200 &&
    Array.isArray(record.originalLines) &&
    record.originalLines.length === record.endLine - record.startLine + 1 &&
    record.originalLines.every((line) => typeof line === "string") &&
    typeof record.replacement === "string" &&
    record.replacement.length <= 65_536 &&
    typeof record.note === "string" &&
    typeof record.sourceRevision === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

export function addSuggestionToState(
  state: ReviewDraftStoreState,
  input: { key: string; suggestion: ReviewDraftSuggestion },
): ReviewDraftStoreState {
  return {
    ...state,
    suggestions: {
      ...state.suggestions,
      [input.key]: [...(state.suggestions[input.key] ?? []), input.suggestion],
    },
  };
}

export function updateSuggestionInState(
  state: ReviewDraftStoreState,
  input: {
    key: string;
    id: string;
    updates: Partial<
      Pick<ReviewDraftSuggestion, "replacement" | "note" | "sourceRevision" | "originalLines">
    >;
    updatedAt: string;
  },
): ReviewDraftStoreState {
  const suggestions = state.suggestions[input.key] ?? [];
  if (!suggestions.some((suggestion) => suggestion.id === input.id)) return state;
  return {
    ...state,
    suggestions: {
      ...state.suggestions,
      [input.key]: suggestions.map((suggestion) => {
        if (suggestion.id !== input.id) return suggestion;
        return {
          id: suggestion.id,
          filePath: suggestion.filePath,
          startLine: suggestion.startLine,
          endLine: suggestion.endLine,
          originalLines: input.updates.originalLines ?? suggestion.originalLines,
          replacement: input.updates.replacement ?? suggestion.replacement,
          note: input.updates.note ?? suggestion.note,
          sourceRevision: input.updates.sourceRevision ?? suggestion.sourceRevision,
          createdAt: suggestion.createdAt,
          updatedAt: input.updatedAt,
        };
      }),
    },
  };
}

export function deleteSuggestionFromState(
  state: ReviewDraftStoreState,
  input: { key: string; id: string },
): ReviewDraftStoreState {
  const suggestions = state.suggestions[input.key] ?? [];
  if (!suggestions.some((suggestion) => suggestion.id === input.id)) return state;
  return {
    ...state,
    suggestions: {
      ...state.suggestions,
      [input.key]: suggestions.filter((suggestion) => suggestion.id !== input.id),
    },
  };
}

function applyCommentUpdates(
  comment: ReviewDraftComment,
  targetId: string,
  updates: Partial<Pick<ReviewDraftComment, "body">>,
  updatedAt: string,
): ReviewDraftComment {
  if (comment.id !== targetId) {
    return comment;
  }
  return {
    id: comment.id,
    filePath: comment.filePath,
    side: comment.side,
    lineNumber: comment.lineNumber,
    body: updates.body ?? comment.body,
    createdAt: comment.createdAt,
    updatedAt,
  };
}
