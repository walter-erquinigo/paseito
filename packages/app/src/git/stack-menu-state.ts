import type { WorkspaceStack } from "@getpaseo/protocol/workspace-stack";

export function selectVisibleWorkspaceStack(input: {
  queryStack: WorkspaceStack | null | undefined;
  retainedStack: WorkspaceStack | null;
  currentBranch: string | null;
}): WorkspaceStack | null {
  const stack = input.queryStack ?? input.retainedStack;
  if (!stack) return null;
  if (input.currentBranch && stack.currentBranch !== input.currentBranch) return null;
  return stack;
}
