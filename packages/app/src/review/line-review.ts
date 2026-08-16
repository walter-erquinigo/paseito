import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { buildNumberedDiffHunks, type ReviewableDiffTarget } from "@/utils/diff-layout";

export interface ReviewableChangedLine {
  id: string;
  fingerprint: string;
  occurrence: number;
  target: ReviewableDiffTarget;
}

export interface ReviewableChangedFile {
  path: string;
  contentRevision: string;
  diffSignature: string;
  fingerprintCounts: Readonly<Record<string, number>>;
  lines: readonly ReviewableChangedLine[];
}

function nearestContext(
  lines: readonly ReviewableDiffTarget[],
  startIndex: number,
  direction: -1 | 1,
): string {
  for (let index = startIndex + direction; index >= 0 && index < lines.length; index += direction) {
    const candidate = lines[index];
    if (candidate?.lineType === "context") return candidate.content;
  }
  return "";
}

export function buildChangedLineFingerprint(
  target: ReviewableDiffTarget,
  previousContext: string,
  nextContext: string,
): string {
  return JSON.stringify([
    target.side,
    target.lineType,
    target.content,
    previousContext,
    nextContext,
  ]);
}

export function buildReviewableChangedFile(file: ParsedDiffFile): ReviewableChangedFile | null {
  const contentRevision = file.contentRevision?.trim();
  if (!contentRevision) return null;

  const allTargets = buildNumberedDiffHunks(file).flatMap((hunk) =>
    hunk.lines.flatMap((line) => {
      if (line.line.type === "header") return [];
      const target = line.line.type === "remove" ? line.oldCell : line.newCell;
      return target ? [target] : [];
    }),
  );
  const occurrences = new Map<string, number>();
  const fingerprintCounts: Record<string, number> = {};
  const lines: ReviewableChangedLine[] = [];

  for (const [index, target] of allTargets.entries()) {
    if (target.lineType !== "add" && target.lineType !== "remove") continue;
    if (!isReviewableChangedLine(target)) continue;
    const fingerprint = buildChangedLineFingerprint(
      target,
      nearestContext(allTargets, index, -1),
      nearestContext(allTargets, index, 1),
    );
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    fingerprintCounts[fingerprint] = (fingerprintCounts[fingerprint] ?? 0) + 1;
    lines.push({
      id: `${file.path}:${fingerprint}:${occurrence}`,
      fingerprint,
      occurrence,
      target,
    });
  }

  const diffSignature = JSON.stringify(lines.map((line) => [line.fingerprint, line.occurrence]));
  return { path: file.path, contentRevision, diffSignature, fingerprintCounts, lines };
}

export function isReviewableChangedLine(target: ReviewableDiffTarget): boolean {
  const content = target.content.slice(1).trim();
  return content !== "" && content !== "];" && content !== "};" && content !== "}";
}

export function buildReviewableChangedFiles(
  files: readonly ParsedDiffFile[],
): ReviewableChangedFile[] {
  return files.flatMap((file) => {
    const reviewable = buildReviewableChangedFile(file);
    return reviewable ? [reviewable] : [];
  });
}
