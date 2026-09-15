import { z } from "zod";

export const WorkspaceStackBranchSchema = z.object({
  name: z.string(),
  sha: z.string(),
  index: z.string(),
  parent: z.string(),
  subject: z.string(),
});

export const WorkspaceStackSchema = z.object({
  prefix: z.string(),
  currentBranch: z.string(),
  branches: z.array(WorkspaceStackBranchSchema),
});

export type WorkspaceStackBranch = z.infer<typeof WorkspaceStackBranchSchema>;
export type WorkspaceStack = z.infer<typeof WorkspaceStackSchema>;
