import { useCallback, useEffect, useMemo } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftKey,
  useInlineReviewController,
  useReviewAttachmentSnapshot,
  useReviewDraftComments,
} from "@/review";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useChangesBaseSelection } from "@/git/use-changes-base-selection";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useWorkingDiffComparison } from "@/git/working-diff-comparison";
import { useSessionStore } from "@/stores/session-store";
import { useDiffContextExpansion } from "@/git/use-diff-context-expansion";

interface UseWorkingDiffOptions {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  ignoreWhitespace: boolean;
  enabled: boolean;
  queryScope?: string;
}

function hasCommittedBranchChanges(
  status: { aheadBehind?: { ahead: number } | null } | null,
): boolean {
  return (status?.aheadBehind?.ahead ?? 0) > 0;
}

function resolveSelectedComparisonBaseRef(
  selection: ReturnType<typeof useChangesBaseSelection>,
): string | undefined {
  return selection.supported && selection.source !== "recorded" && selection.effectiveBaseRef
    ? selection.effectiveBaseRef
    : undefined;
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

export function useWorkingDiff({
  serverId,
  workspaceId,
  cwd,
  ignoreWhitespace,
  enabled,
  queryScope,
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
  const currentBranchName = getCurrentBranchName(gitStatus);
  const baseSelection = useChangesBaseSelection({
    serverId,
    cwd,
    repoRoot: gitStatus?.repoRoot,
    currentBranch: currentBranchName,
    recordedBaseRef,
    stackParent: gitStatus?.stackParent,
  });
  const baseRef = baseSelection.effectiveBaseRef;
  const comparisonBaseRef = resolveSelectedComparisonBaseRef(baseSelection);
  const hasCommittedChanges =
    hasCommittedBranchChanges(gitStatus) || baseSelection.source === "stack-parent";

  const { comparison: diffMode, selectComparison } = useWorkingDiffComparison({
    serverId,
    workspaceId,
    cwd,
    isDirty: hasUncommittedChanges,
    hasCommittedChanges,
  });
  const selectUncommitted = useCallback(() => selectComparison("uncommitted"), [selectComparison]);
  const selectBase = useCallback(() => selectComparison("base"), [selectComparison]);

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
  const requestedContextLines = useMemo(
    () =>
      persistedComments
        .filter((comment) => comment.side === "new")
        .map((comment) => ({ filePath: comment.filePath, lineNumber: comment.lineNumber })),
    [persistedComments],
  );
  const contextExpansionSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.changesContextExpansion === true,
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
  const reviewActions = useInlineReviewController({ reviewDraftKey });
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
    currentBranchName,
    baseSelection,
    hasUncommittedChanges,
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
