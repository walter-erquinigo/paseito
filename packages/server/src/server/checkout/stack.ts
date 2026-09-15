import type { WorkspaceStack, WorkspaceStackBranch } from "@getpaseo/protocol/workspace-stack";
import { runGitCommand } from "../../utils/run-git-command.js";

export class InvalidWorkspaceStackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkspaceStackError";
  }
}

interface BranchTip {
  name: string;
  sha: string;
  message: string;
}

interface StackMember {
  branch: WorkspaceStackBranch;
  prefix: string;
  namespace: string;
  identity: string;
}

function parseMember(tip: BranchTip): StackMember {
  const markers = new Map<string, string>();
  for (const line of tip.message.replaceAll("\r\n", "\n").split("\n")) {
    if (!line.startsWith("Stack-")) continue;
    const match = /^(Stack-[A-Za-z][A-Za-z0-9-]*): (\S+)$/.exec(line);
    if (!match || markers.has(match[1]!)) {
      throw new InvalidWorkspaceStackError(`Malformed or duplicate Stack metadata on ${tip.name}`);
    }
    markers.set(match[1]!, match[2]!);
  }
  const prefix = markers.get("Stack-Prefix");
  const index = markers.get("Stack-Index");
  const parent = markers.get("Stack-Parent");
  if (!prefix || !index || !parent || !/^[a-z]+$/.test(index)) {
    throw new InvalidWorkspaceStackError(`Incomplete Stack metadata on ${tip.name}`);
  }
  const stem = `${prefix}-${index}-`;
  const start = tip.name.lastIndexOf(stem);
  const namespace = tip.name.slice(0, start);
  const validName =
    start >= 0 && (start === 0 || namespace.endsWith("/")) && tip.name.length > start + stem.length;
  if (!validName || parent === tip.name) {
    throw new InvalidWorkspaceStackError(
      `Branch name or parent disagrees with Stack metadata on ${tip.name}`,
    );
  }
  // Stack's project-specific issue trailer is configuration, not an employer-specific key.
  for (const key of ["Stack-Prefix", "Stack-Index", "Stack-Parent"]) markers.delete(key);
  const identity = JSON.stringify([...markers].sort(([a], [b]) => a.localeCompare(b)));
  return {
    prefix,
    namespace,
    identity,
    branch: { name: tip.name, sha: tip.sha, index, parent, subject: tip.message.split("\n")[0]! },
  };
}

export async function getWorkspaceStack(cwd: string): Promise<WorkspaceStack | null> {
  const head = await runGitCommand(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd,
    acceptExitCodes: [0, 1],
    envOverlay: { GIT_OPTIONAL_LOCKS: "0" },
  });
  if (head.exitCode === 1) return null;
  const currentBranch = head.stdout.trim();
  // One bounded read of branch tips, never a walk of LLVM's commit history or remote refs.
  const refs = await runGitCommand(
    ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(contents)%00", "refs/heads/"],
    { cwd, maxOutputBytes: 8 * 1024 * 1024, envOverlay: { GIT_OPTIONAL_LOCKS: "0" } },
  );
  if (refs.truncated)
    throw new InvalidWorkspaceStackError("Stack branch listing exceeded its size limit");
  const fields = refs.stdout.split("\0");
  const tips: BranchTip[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const ref = fields[i]!.trim();
    const sha = fields[i + 1]!;
    if (!ref.startsWith("refs/heads/") || !/^[a-f0-9]{40,64}$/.test(sha)) {
      throw new InvalidWorkspaceStackError("Invalid Stack branch listing");
    }
    tips.push({ name: ref.slice("refs/heads/".length), sha, message: fields[i + 2]! });
  }
  const tip = tips.find((item) => item.name === currentBranch);
  if (!tip || !/^Stack-/m.test(tip.message)) return null;
  const current = parseMember(tip);
  const candidates = tips.filter((item) =>
    item.name.startsWith(`${current.namespace}${current.prefix}-`),
  );
  const members = candidates.map(parseMember);
  if (
    members.some((item) => item.identity !== current.identity || item.prefix !== current.prefix)
  ) {
    throw new InvalidWorkspaceStackError("Stack branches disagree on their identity metadata");
  }
  const branches = members.map((item) => item.branch);
  branches.sort((a, b) => {
    if (a.index === b.index) return 0;
    return a.index < b.index ? -1 : 1;
  });
  if (new Set(branches.map((item) => item.index)).size !== branches.length) {
    throw new InvalidWorkspaceStackError("Stack indices must be unique");
  }
  for (let i = 1; i < branches.length; i++) {
    if (branches[i]!.parent !== branches[i - 1]!.name) {
      throw new InvalidWorkspaceStackError(`Stack parent chain is broken at ${branches[i]!.name}`);
    }
  }
  if (branches.some((item) => item.name === branches[0]!.parent)) {
    throw new InvalidWorkspaceStackError("Stack parent chain contains a cycle");
  }
  return { prefix: current.prefix, currentBranch, branches };
}
