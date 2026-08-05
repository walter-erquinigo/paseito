import { useCallback, useEffect, useMemo } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftKey,
  buildReviewDraftScopeKey,
  useInlineReviewController,
  useResolvedDiffMode,
  useReviewAttachmentSnapshot,
  useSetDiffModeOverride,
} from "@/review";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useChangesBaseSelection } from "@/git/use-changes-base-selection";

interface UseWorkingDiffOptions {
  serverId: string;
  workspaceId?: string;
  cwd: string;
  ignoreWhitespace: boolean;
  enabled: boolean;
  queryScope?: string;
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
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage =
    status?.error?.message ??
    (isStatusError && statusError instanceof Error ? statusError.message : null);
  const recordedBaseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const currentBranchName =
    gitStatus?.currentBranch && gitStatus.currentBranch !== "HEAD" ? gitStatus.currentBranch : null;
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

  const {
    files,
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
    baseSelection,
    currentBranchName,
    diffMode,
    selectUncommitted,
    selectBase,
    files,
    diffPayloadError,
    diffTooLarge,
    isDiffLoading,
    reviewActions,
    reviewAttachment,
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
