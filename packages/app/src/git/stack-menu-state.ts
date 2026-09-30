import type { WorkspaceStack } from "@getpaseo/protocol/workspace-stack";

export function selectVisibleWorkspaceStack(input: {
  queryStack: WorkspaceStack | null | undefined;
  retainedStack: WorkspaceStack | null;
}): WorkspaceStack | null {
  return input.queryStack ?? input.retainedStack;
}
