import { afterEach, describe, expect, it } from "vitest";
import { resolveChangesLspTarget } from "./changes-lsp-target.web";

function eventAt(target: Element, offsetNode: Node, offset: number): MouseEvent {
  const event = new MouseEvent("mousemove", { clientX: 17, clientY: 23 });
  Object.defineProperty(event, "target", { value: target });
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => ({ offsetNode, offset }),
  });
  return event;
}

function mountRow(input: {
  file?: string;
  line?: number;
  source: string;
  wrapped?: boolean;
  split?: "left" | "right";
}) {
  const row = document.createElement("div");
  if (input.file) row.dataset.paseitoDiffFile = input.file;
  if (input.line) row.dataset.paseitoDiffCurrentLine = String(input.line);
  if (input.wrapped) row.dataset.wrapped = "true";
  if (input.split) row.dataset.splitSide = input.split;
  const review = document.createElement("button");
  review.dataset.reviewCheckbox = "true";
  const gutter = document.createElement("span");
  gutter.dataset.lineNumber = "true";
  gutter.textContent = "104";
  const source = document.createElement("span");
  source.dataset.paseitoDiffSourceText = "true";
  const token = document.createElement("span");
  token.textContent = input.source;
  source.append(token);
  row.append(review, gutter, source);
  document.body.append(row);
  return { gutter, review, row, source, token, text: token.firstChild as Text };
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "caretPositionFromPoint");
});

describe("Changes LSP source targeting", () => {
  it.each([
    { name: "unified", wrapped: false, split: undefined },
    { name: "wrapped", wrapped: true, split: undefined },
    { name: "split current side", wrapped: false, split: "right" as const },
  ])("anchors $name columns to source text", ({ wrapped, split }) => {
    const fixture = mountRow({
      file: "src/main.cc",
      line: 104,
      source: "\tα😀name",
      wrapped,
      split,
    });
    expect(resolveChangesLspTarget(eventAt(fixture.token, fixture.text, 4))).toEqual({
      filePath: "src/main.cc",
      lineNumber: 104,
      column: 5,
      clientX: 17,
      clientY: 23,
    });
  });

  it("rejects gutters, review checkboxes, deleted-side rows, and caret nodes outside source", () => {
    const current = mountRow({ file: "src/main.cc", line: 7, source: "value" });
    expect(resolveChangesLspTarget(eventAt(current.gutter, current.text, 2))).toBeNull();
    expect(resolveChangesLspTarget(eventAt(current.review, current.text, 2))).toBeNull();
    expect(
      resolveChangesLspTarget(eventAt(current.token, current.gutter.firstChild!, 1)),
    ).toBeNull();

    const oldSide = mountRow({ file: "src/main.cc", source: "removed" });
    expect(resolveChangesLspTarget(eventAt(oldSide.token, oldSide.text, 3))).toBeNull();
  });
});
