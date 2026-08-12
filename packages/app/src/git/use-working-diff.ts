import { useCallback, useEffect, useMemo } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftKey,
  buildReviewDraftScopeKey,
  useInlineReviewController,
  useFileReviews,
  useResolvedDiffMode,
  useReviewAttachmentSnapshot,
  useReviewDraftComments,
  useReviewDraftSuggestions,
  useSetDiffModeOverride,
} from "@/review";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useChangesBaseSelection } from "@/git/use-changes-base-selection";
import { useSessionStore } from "@/stores/session-store";
import { useDiffContextExpansion } from "@/git/use-diff-context-expansion";
import { buildNumberedDiffHunks } from "@/utils/diff-layout";

interface UseWorkingDiffOptions {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  ignoreWhitespace: boolean;
  enabled: boolean;
  queryScope?: string;
  requestedNavigationLine?: { filePath: string; lineNumber: number };
}

function collectCurrentSideReviewTargets(files: ReturnType<typeof useCheckoutDiffQuery>["files"]) {
  return files.flatMap((file) =>
    buildNumberedDiffHunks(file).flatMap((hunk) =>
      hunk.lines.map((line) => line.newCell).filter((cell) => cell !== null),
    ),
  );
}

function resolveSelectedComparisonBaseRef(
  selection: ReturnType<typeof useChangesBaseSelection>,
): string | undefined {
  return selection.supported &&
    selection.selectedBaseRef !== null &&
    selection.selectedBaseRef === selection.effectiveBaseRef
    ? selection.effectiveBaseRef
    : undefined;
}

function hasCommittedBranchChanges(
  status: { aheadBehind?: { ahead: number } | null } | null,
): boolean {
  return (status?.aheadBehind?.ahead ?? 0) > 0;
}

function getGitStatus(status: ReturnType<typeof useCheckoutStatusQuery>["status"]) {
  return status?.isGit === true ? status : null;
}

function isNotGitStatus(status: ReturnType<typeof useCheckoutStatusQuery>["status"]): boolean {
  return status?.isGit === false && !status.error;
}

function getStatusErrorMessage(input: {
  status: ReturnType<typeof useCheckoutStatusQuery>["status"];
  isStatusError: boolean;
  statusError: unknown;
}): string | null {
  if (input.status?.error?.message) return input.status.error.message;
  return input.isStatusError && input.statusError instanceof Error
    ? input.statusError.message
    : null;
}

function getCurrentBranchName(gitStatus: ReturnType<typeof getGitStatus>): string | null {
  const branch = gitStatus?.currentBranch;
  return branch && branch !== "HEAD" ? branch : null;
}

function getFileReviewRepositoryRoot(gitStatus: ReturnType<typeof getGitStatus>): string | null {
  if (!gitStatus) return null;
  return gitStatus.mainRepoRoot ?? gitStatus.repoRoot;
}

export function useWorkingDiff({
  serverId,
  workspaceId,
  cwd,
  ignoreWhitespace,
  enabled,
  queryScope,
  requestedNavigationLine,
}: UseWorkingDiffOptions) {
  const {
    status,
    isLoading: isStatusLoading,
    isError: isStatusError,
    error: statusError,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = getGitStatus(status);
  const isGit = Boolean(gitStatus);
  const notGit = isNotGitStatus(status);
  const statusErrorMessage = getStatusErrorMessage({ status, isStatusError, statusError });
  const recordedBaseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const hasCommittedChanges = hasCommittedBranchChanges(gitStatus);
  const currentBranchName = getCurrentBranchName(gitStatus);
  const baseSelection = useChangesBaseSelection({
    serverId,
    cwd,
    repoRoot: gitStatus?.repoRoot,
    currentBranch: currentBranchName,
    recordedBaseRef,
  });
  const baseRef = baseSelection.effectiveBaseRef;
  const comparisonBaseRef = resolveSelectedComparisonBaseRef(baseSelection);

  const reviewDraftScopeKey = useMemo(
    () =>
      buildReviewDraftScopeKey({
        serverId,
        workspaceId,
        cwd,
        baseRef,
        ignoreWhitespace,
      }),
    [baseRef, cwd, ignoreWhitespace, serverId, workspaceId],
  );
  const diffMode = useResolvedDiffMode({
    scopeKey: reviewDraftScopeKey,
    hasUncommittedChanges,
    hasCommittedChanges,
  });
  const setDiffModeOverride = useSetDiffModeOverride();
  const selectDiffMode = useCallback(
    (mode: "uncommitted" | "base") => {
      setDiffModeOverride({
        scopeKey: reviewDraftScopeKey,
        override: { serverId, cwd, mode, isDirtyAtSelection: hasUncommittedChanges },
      });
    },
    [cwd, hasUncommittedChanges, reviewDraftScopeKey, serverId, setDiffModeOverride],
  );
  const selectUncommitted = useCallback(() => selectDiffMode("uncommitted"), [selectDiffMode]);
  const selectBase = useCallback(() => selectDiffMode("base"), [selectDiffMode]);
  const reviewDraftKey = useMemo(
    () =>
      buildReviewDraftKey({
        serverId,
        workspaceId,
        cwd,
        mode: diffMode,
        baseRef,
        ignoreWhitespace,
      }),
    [baseRef, cwd, diffMode, ignoreWhitespace, serverId, workspaceId],
  );
  const persistedComments = useReviewDraftComments(reviewDraftKey);
  const persistedSuggestions = useReviewDraftSuggestions(reviewDraftKey);
  const requestedContextLines = useMemo(
    () => [
      ...persistedComments
        .filter((comment) => comment.side === "new")
        .map((comment) => ({ filePath: comment.filePath, lineNumber: comment.lineNumber })),
      ...persistedSuggestions.map((suggestion) => ({
        filePath: suggestion.filePath,
        lineNumber: suggestion.startLine,
      })),
      ...(requestedNavigationLine ? [requestedNavigationLine] : []),
    ],
    [persistedComments, persistedSuggestions, requestedNavigationLine],
  );

  const {
    files: sourceFiles,
    payloadError: diffPayloadError,
    diffTooLarge,
    isLoading: isDiffLoading,
  } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: diffMode,
    baseRef: comparisonBaseRef,
    ignoreWhitespace,
    enabled: enabled && isGit,
    queryScope,
  });
  const contextExpansionSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.changesContextExpansion === true,
  );
  const suggestionsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.reviewSuggestionsV1 === true,
  );
  const fileReviewSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.fileReviewV1 === true,
  );
  const contextExpansion = useDiffContextExpansion({
    serverId,
    cwd,
    compare: {
      mode: diffMode,
      ...(diffMode === "base" && comparisonBaseRef ? { baseRef: comparisonBaseRef } : {}),
      ignoreWhitespace,
    },
    files: sourceFiles,
    supported: contextExpansionSupported,
    requestedLines: requestedContextLines,
  });
  const files = contextExpansion.files;
  const fileReviews = useFileReviews({
    serverId,
    repositoryRoot: getFileReviewRepositoryRoot(gitStatus),
    branch: currentBranchName,
    files,
    supported: fileReviewSupported,
  });
  const availableTargets = useMemo(() => collectCurrentSideReviewTargets(files), [files]);
  const reviewActions = useInlineReviewController({
    reviewDraftKey,
    availableTargets,
    suggestionsSupported,
  });
  const reviewAttachment = useReviewAttachmentSnapshot({
    key: reviewDraftKey,
    diffFiles: files,
    cwd,
    mode: diffMode,
    baseRef,
  });

  return {
    status,
    isStatusLoading,
    isGit,
    notGit,
    statusErrorMessage,
    baseRef,
    comparisonBaseRef,
    baseSelection,
    currentBranchName,
    diffMode,
    selectUncommitted,
    selectBase,
    files,
    sourceFiles,
    diffPayloadError,
    diffTooLarge,
    isDiffLoading,
    reviewActions,
    reviewAttachment,
    reviewDraftKey,
    contextExpansion,
    contextExpansionSupported,
    suggestionsSupported,
    fileReviews,
  };
}

export function usePublishWorkingDiffAttachment({
  serverId,
  workspaceId,
  cwd,
  attachment,
  enabled,
}: {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  attachment: ReturnType<typeof useWorkingDiff>["reviewAttachment"];
  enabled: boolean;
}) {
  const scopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );
  const setWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.setWorkspaceAttachments,
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const attachments = attachment ? [attachment] : [];
    setWorkspaceAttachments({ scopeKey, attachments });
    return () => {
      const current = useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey];
      if (current === attachments) {
        clearWorkspaceAttachments({ scopeKey });
      }
    };
  }, [attachment, clearWorkspaceAttachments, enabled, scopeKey, setWorkspaceAttachments]);
}
