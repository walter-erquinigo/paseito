import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { getFileReviewSnapshot, type FileReviewRecord } from "./file-review";
import { buildReviewableChangedFile } from "./line-review";

function diff(
  lines: ParsedDiffFile["hunks"][number]["lines"],
  overrides: Partial<ParsedDiffFile> = {},
): ParsedDiffFile {
  return {
    path: "src/example.ts",
    isNew: false,
    isDeleted: false,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "remove").length,
    hunks: [{ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3, lines }],
    contentRevision: "revision-1",
    newLineCount: 3,
    ...overrides,
  };
}

function reviewedRecord(
  file: NonNullable<ReturnType<typeof buildReviewableChangedFile>>,
): FileReviewRecord {
  return {
    reviewedRevision: file.contentRevision,
    lastSeenRevision: file.contentRevision,
    reviewedAt: "2026-08-10T00:00:00.000Z",
    reviewedLines: file.lines.map(({ fingerprint, occurrence }) => ({ fingerprint, occurrence })),
    lastSeenDiffSignature: file.diffSignature,
    lastSeenFingerprintCounts: { ...file.fingerprintCounts },
  };
}

describe("line review identity", () => {
  it("excludes blank and structural-only edits from review", () => {
    const file = buildReviewableChangedFile(
      diff([
        { type: "add", content: "+" },
        { type: "add", content: "+   " },
        { type: "add", content: "+];" },
        { type: "remove", content: "-};" },
        { type: "add", content: "+}" },
        { type: "add", content: "+value();" },
      ]),
    );

    expect(file?.lines.map((line) => line.target.content)).toEqual(["+value();"]);
  });

  it("creates separate review entries for both sides of a replacement", () => {
    const file = buildReviewableChangedFile(
      diff([
        { type: "context", content: " unchanged" },
        { type: "remove", content: "-before" },
        { type: "add", content: "+after" },
        { type: "context", content: " trailing" },
      ]),
    );

    expect(file?.lines.map((line) => line.target.lineType)).toEqual(["remove", "add"]);
    expect(new Set(file?.lines.map((line) => line.id)).size).toBe(2);
  });

  it("materializes a legacy checked file as fully line-reviewed", () => {
    const file = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "remove", content: "-old" },
        { type: "add", content: "+new" },
      ]),
    );
    const snapshot = getFileReviewSnapshot(
      {
        "src/example.ts": {
          reviewedRevision: "revision-1",
          lastSeenRevision: "revision-1",
          reviewedAt: "2026-08-10T00:00:00.000Z",
        },
      },
      [file!],
    );

    expect(snapshot.reviewedLineCount).toBe(2);
    expect(snapshot.reviewedPaths.has("src/example.ts")).toBe(true);
  });

  it("derives mixed and complete file state from physical edited lines", () => {
    const file = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "remove", content: "-old" },
        { type: "add", content: "+new" },
        { type: "context", content: " after" },
      ]),
    );
    expect(file).not.toBeNull();
    const [first, second] = file!.lines;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const partial = getFileReviewSnapshot(
      {
        "src/example.ts": {
          reviewedRevision: "",
          lastSeenRevision: file!.contentRevision,
          reviewedAt: "2026-08-10T00:00:00.000Z",
          reviewedLines: [{ fingerprint: first!.fingerprint, occurrence: first!.occurrence }],
          lastSeenDiffSignature: file!.diffSignature,
          lastSeenFingerprintCounts: { ...file!.fingerprintCounts },
        },
      },
      [file!],
    );
    expect(partial.lineProgressByPath.get("src/example.ts")).toEqual({ reviewed: 1, total: 2 });
    expect(partial.reviewedPaths.has("src/example.ts")).toBe(false);

    const complete = getFileReviewSnapshot({ "src/example.ts": reviewedRecord(file!) }, [file!]);
    expect(complete.lineProgressByPath.get("src/example.ts")).toEqual({ reviewed: 2, total: 2 });
    expect(complete.reviewedPaths.has("src/example.ts")).toBe(true);
  });

  it("keeps unique exact matches but leaves newly added edits unchecked", () => {
    const original = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "remove", content: "-old" },
        { type: "add", content: "+new" },
        { type: "context", content: " after" },
      ]),
    );
    const changed = buildReviewableChangedFile(
      diff(
        [
          { type: "add", content: "+unrelated" },
          { type: "context", content: " before" },
          { type: "remove", content: "-old" },
          { type: "add", content: "+new" },
          { type: "context", content: " after" },
        ],
        { contentRevision: "revision-2" },
      ),
    );
    expect(original).not.toBeNull();
    expect(changed).not.toBeNull();

    const snapshot = getFileReviewSnapshot({ "src/example.ts": reviewedRecord(original!) }, [
      changed!,
    ]);
    expect(snapshot.reviewedLineCount).toBe(2);
    expect(snapshot.reviewableLineCount).toBe(3);
    expect(snapshot.reviewedPaths.has("src/example.ts")).toBe(false);
    expect(snapshot.invalidatedPaths).toEqual(["src/example.ts"]);
  });

  it("keeps duplicate edits reviewed when their anchored group is unchanged", () => {
    const original = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "add", content: "+same" },
        { type: "add", content: "+same" },
        { type: "context", content: " after" },
      ]),
    );
    const changed = buildReviewableChangedFile(
      diff(
        [
          { type: "context", content: " before" },
          { type: "add", content: "+same" },
          { type: "add", content: "+same" },
          { type: "add", content: "+different" },
          { type: "context", content: " after" },
        ],
        { contentRevision: "revision-2" },
      ),
    );

    const snapshot = getFileReviewSnapshot({ "src/example.ts": reviewedRecord(original!) }, [
      changed!,
    ]);
    expect(snapshot.reviewedLineCount).toBe(2);
  });

  it("preserves the reviewed ordinal within an unchanged duplicate group", () => {
    const original = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "add", content: "+same" },
        { type: "add", content: "+same" },
        { type: "context", content: " after" },
      ]),
    );
    const changed = buildReviewableChangedFile(
      diff(
        [
          { type: "add", content: "+unrelated" },
          { type: "context", content: " before" },
          { type: "add", content: "+same" },
          { type: "add", content: "+same" },
          { type: "context", content: " after" },
        ],
        { contentRevision: "revision-2" },
      ),
    );
    expect(original).not.toBeNull();
    expect(changed).not.toBeNull();
    const record = reviewedRecord(original!);
    record.reviewedRevision = "";
    record.reviewedLines = [original!.lines[1]!];

    const snapshot = getFileReviewSnapshot({ "src/example.ts": record }, [changed!]);
    expect(snapshot.reviewedLineCount).toBe(1);
    expect(snapshot.reviewedLineIds.has(changed!.lines[2]!.id)).toBe(true);
  });

  it("clears a duplicate group when an identical edit is inserted", () => {
    const original = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "add", content: "+same" },
        { type: "add", content: "+same" },
        { type: "context", content: " after" },
      ]),
    );
    const changed = buildReviewableChangedFile(
      diff(
        [
          { type: "context", content: " before" },
          { type: "add", content: "+same" },
          { type: "add", content: "+same" },
          { type: "add", content: "+same" },
          { type: "context", content: " after" },
        ],
        { contentRevision: "revision-2" },
      ),
    );

    const snapshot = getFileReviewSnapshot({ "src/example.ts": reviewedRecord(original!) }, [
      changed!,
    ]);
    expect(snapshot.reviewedLineCount).toBe(0);
  });

  it("clears duplicate edits that move across a stable anchor", () => {
    const original = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "add", content: "+same" },
        { type: "add", content: "+anchor" },
        { type: "add", content: "+same" },
        { type: "context", content: " after" },
      ]),
    );
    const changed = buildReviewableChangedFile(
      diff(
        [
          { type: "context", content: " before" },
          { type: "add", content: "+same" },
          { type: "add", content: "+same" },
          { type: "add", content: "+anchor" },
          { type: "context", content: " after" },
        ],
        { contentRevision: "revision-2" },
      ),
    );
    const record = reviewedRecord(original!);
    const duplicateFingerprint = original!.lines[0]!.fingerprint;
    record.reviewedLines = record.reviewedLines!.filter(
      (line) => line.fingerprint === duplicateFingerprint,
    );

    const snapshot = getFileReviewSnapshot({ "src/example.ts": record }, [changed!]);
    expect(snapshot.reviewedLineCount).toBe(0);
  });

  it("falls back to unique-only remapping for a malformed prior signature", () => {
    const original = buildReviewableChangedFile(
      diff([
        { type: "context", content: " before" },
        { type: "add", content: "+unique" },
        { type: "add", content: "+same" },
        { type: "add", content: "+same" },
        { type: "context", content: " after" },
      ]),
    );
    const changed = buildReviewableChangedFile(
      diff(
        [
          { type: "context", content: " before" },
          { type: "add", content: "+unique" },
          { type: "add", content: "+same" },
          { type: "add", content: "+same" },
          { type: "add", content: "+different" },
          { type: "context", content: " after" },
        ],
        { contentRevision: "revision-2" },
      ),
    );
    const record = reviewedRecord(original!);
    record.lastSeenDiffSignature = "not-json";

    const snapshot = getFileReviewSnapshot({ "src/example.ts": record }, [changed!]);
    expect(snapshot.reviewedLineCount).toBe(1);
    expect(snapshot.reviewedLineIds.has(changed!.lines[0]!.id)).toBe(true);
  });
});
