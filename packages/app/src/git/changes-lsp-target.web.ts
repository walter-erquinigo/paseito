import type { ChangesLspTarget } from "./changes-lsp-target";

export type { ChangesLspTarget } from "./changes-lsp-target";

export function resolveChangesLspTarget(event: MouseEvent): ChangesLspTarget | null {
  if (!(event.target instanceof Node)) return null;
  const element = event.target instanceof Element ? event.target : event.target.parentElement;
  const source = element?.closest<HTMLElement>("[data-paseito-diff-source-text]");
  const row = source?.closest<HTMLElement>(
    "[data-paseito-diff-file][data-paseito-diff-current-line]",
  );
  if (!source || !row) return null;
  const filePath = row.dataset.paseitoDiffFile;
  const lineNumber = Number(row.dataset.paseitoDiffCurrentLine);
  if (!filePath || !Number.isSafeInteger(lineNumber)) return null;
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  const caretPosition = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
  const caretRange = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
  const offsetNode = caretPosition?.offsetNode ?? caretRange?.startContainer;
  const offset = caretPosition?.offset ?? caretRange?.startOffset;
  if (!offsetNode || offset === undefined || !source.contains(offsetNode)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(source);
  prefix.setEnd(offsetNode, offset);
  return {
    filePath,
    lineNumber,
    column: prefix.toString().length + 1,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}
