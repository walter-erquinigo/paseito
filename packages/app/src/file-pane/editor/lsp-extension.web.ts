import {
  autocompletion,
  completionKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { keymap, EditorView, hoverTooltip, ViewPlugin, type Tooltip } from "@codemirror/view";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type {
  WorkspaceLspCompletionItem,
  WorkspaceLspDiagnostic,
  WorkspaceLspHover,
  WorkspaceLspLocation,
} from "@getpaseo/protocol/messages";
import type { EditorLspSession } from "./lsp-session";

export function editorLspExtensions(input: {
  session: EditorLspSession;
  onOpenDefinition(location: WorkspaceLspLocation): void;
}) {
  let diagnosticsTimer: ReturnType<typeof setTimeout> | null = null;
  let diagnosticsSequence = 0;

  async function refreshDiagnostics(view: EditorView): Promise<void> {
    const sequence = ++diagnosticsSequence;
    const diagnostics = await input.session.diagnostics();
    if (sequence !== diagnosticsSequence) return;
    view.dispatch(
      setDiagnostics(
        view.state,
        diagnostics.flatMap((item) => toDiagnostic(view, item)),
      ),
    );
  }

  function scheduleDiagnostics(view: EditorView): void {
    if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
    diagnosticsTimer = setTimeout(() => {
      diagnosticsTimer = null;
      void refreshDiagnostics(view);
    }, 300);
  }

  return [
    autocompletion({
      activateOnTyping: true,
      override: [(context) => completionSource(input.session, context)],
    }),
    lintGutter(),
    hoverTooltip((view, position) => hoverSource(input.session, view, position)),
    keymap.of([
      ...completionKeymap,
      {
        key: "F12",
        preventDefault: true,
        run(view) {
          void openDefinition(input.session, view, input.onOpenDefinition);
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      input.session.change(update.state.doc.toString());
      scheduleDiagnostics(update.view);
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
        const position = view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
        if (position === null) return false;
        event.preventDefault();
        void openDefinition(input.session, view, input.onOpenDefinition, position);
        return true;
      },
    }),
    ViewPlugin.fromClass(
      class {
        private destroyed = false;

        constructor(view: EditorView) {
          void input.session.open(view.state.doc.toString()).then(() => {
            if (!this.destroyed) scheduleDiagnostics(view);
            return undefined;
          });
        }

        destroy() {
          this.destroyed = true;
          diagnosticsSequence += 1;
          if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
          diagnosticsTimer = null;
        }
      },
    ),
  ];
}

async function completionSource(
  session: EditorLspSession,
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const word = context.matchBefore(/[\w$]*$/);
  if (!context.explicit && (!word || word.from === word.to)) return null;
  const position = lspPosition(context.state.doc, context.pos);
  const result = await session.completion(position);
  if (result.items.length === 0) return null;
  return {
    from: word?.from ?? context.pos,
    options: result.items.map((item) => completionOption(item)),
    validFor: /^[\w$]*$/,
  };
}

function completionOption(item: WorkspaceLspCompletionItem): Completion {
  const documentation = markupText(item.documentation);
  return {
    label: item.label,
    detail: item.detail,
    info: documentation || undefined,
    type: completionKind(item.kind),
    boost: item.sortText ? 1 : undefined,
    apply(view, _completion, from, to) {
      const changes = [];
      if (item.textEdit) {
        const range = rangeOffsets(view, item.textEdit.range);
        changes.push({
          from: range.from,
          to: range.to,
          insert: item.textEdit.newText,
        });
      } else {
        changes.push({ from, to, insert: item.insertText ?? item.label });
      }
      for (const edit of item.additionalTextEdits ?? []) {
        const range = rangeOffsets(view, edit.range);
        changes.push({ from: range.from, to: range.to, insert: edit.newText });
      }
      changes.sort((left, right) => left.from - right.from || left.to - right.to);
      for (let index = 1; index < changes.length; index += 1) {
        if (changes[index - 1]!.to > changes[index]!.from) return;
      }
      view.dispatch({ changes });
    },
  };
}

async function hoverSource(
  session: EditorLspSession,
  view: EditorView,
  position: number,
): Promise<Tooltip | null> {
  const hover = await session.hover(lspPosition(view.state.doc, position));
  if (!hover) return null;
  const text = hoverText(hover);
  if (!text) return null;
  const range = hover.range ? rangeOffsets(view, hover.range) : null;
  return {
    pos: range?.from ?? position,
    end: range?.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-lsp-hover";
      dom.textContent = text;
      return { dom };
    },
  };
}

async function openDefinition(
  session: EditorLspSession,
  view: EditorView,
  onOpen: (location: WorkspaceLspLocation) => void,
  position = view.state.selection.main.head,
): Promise<void> {
  const locations = await session.definition(lspPosition(view.state.doc, position));
  const first = locations[0];
  if (first) onOpen(first);
}

function toDiagnostic(view: EditorView, item: WorkspaceLspDiagnostic): Diagnostic[] {
  try {
    const range = rangeOffsets(view, item.range);
    return [
      {
        from: range.from,
        to: Math.max(range.from, range.to),
        severity: diagnosticSeverity(item.severity),
        message: item.message,
        source: item.source,
      },
    ];
  } catch {
    return [];
  }
}

function diagnosticSeverity(severity: number | undefined): Diagnostic["severity"] {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  return "info";
}

function rangeOffsets(
  view: EditorView,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  },
): { from: number; to: number } {
  return {
    from: documentOffset(view, range.start.line, range.start.character),
    to: documentOffset(view, range.end.line, range.end.character),
  };
}

function documentOffset(view: EditorView, line: number, character: number): number {
  const documentLine = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
  return Math.min(documentLine.from + character, documentLine.to);
}

function lspPosition(
  document: { lineAt(position: number): { number: number; from: number } },
  position: number,
) {
  const line = document.lineAt(position);
  return { line: line.number - 1, character: position - line.from };
}

function markupText(value: WorkspaceLspCompletionItem["documentation"]): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.value;
}

function hoverText(hover: WorkspaceLspHover): string {
  if (typeof hover.contents === "string") return hover.contents;
  if (Array.isArray(hover.contents)) {
    return hover.contents
      .map((part) => (typeof part === "string" ? part : part.value))
      .join("\n\n");
  }
  return hover.contents.value;
}

function completionKind(kind: number | undefined): string | undefined {
  if (kind === 2 || kind === 3) return "method";
  if (kind === 4) return "constructor";
  if (kind === 5 || kind === 6) return "field";
  if (kind === 7) return "class";
  if (kind === 9 || kind === 10) return "property";
  if (kind === 14) return "keyword";
  if (kind === 15) return "snippet";
  return undefined;
}
