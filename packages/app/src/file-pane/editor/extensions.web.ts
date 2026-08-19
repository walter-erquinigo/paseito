import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { createCodeMirrorHighlightStyle, type HighlightStyle } from "@getpaseo/highlight";

export interface EditorVisualTheme {
  colorScheme: "light" | "dark";
  background: string;
  foreground: string;
  cursor: string;
  foregroundMuted: string;
  border: string;
  selection: string;
  surfaceRaised: string;
  codeBackground: string;
  uiFont: string;
  monoFont: string;
  codeFontSize: number;
  syntax: Record<HighlightStyle, string>;
}

export function editorBaseExtensions(onSave: () => void) {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
  ];
}

export function editorTheme(theme: EditorVisualTheme) {
  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          backgroundColor: theme.background,
          color: theme.foreground,
          fontFamily: theme.monoFont,
          fontSize: `${theme.codeFontSize}px`,
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: theme.monoFont,
          lineHeight: "1.45",
        },
        ".cm-content": { caretColor: theme.foreground, padding: "16px 0" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: theme.cursor },
        ".cm-gutters": {
          backgroundColor: theme.background,
          color: theme.foregroundMuted,
          borderRight: `1px solid ${theme.border}`,
        },
        ".cm-activeLine": { backgroundColor: "transparent" },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: theme.foreground },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
          backgroundColor: theme.selection,
        },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: theme.selection,
        },
        ".cm-lsp-hover": {
          boxSizing: "border-box",
          maxWidth: "560px",
          maxHeight: "min(420px, 60vh)",
          overflow: "auto",
          padding: "12px",
          border: `1px solid ${theme.border}`,
          borderRadius: "8px",
          backgroundColor: theme.surfaceRaised,
          color: theme.foreground,
          fontFamily: theme.uiFont,
          fontSize: `${theme.codeFontSize}px`,
          lineHeight: "1.5",
          userSelect: "text",
        },
        ".cm-lsp-hover-part + .cm-lsp-hover-part": {
          marginTop: "8px",
        },
        ".cm-lsp-hover-plaintext": {
          whiteSpace: "pre-wrap",
        },
        ".cm-lsp-hover h1, .cm-lsp-hover h2, .cm-lsp-hover h3, .cm-lsp-hover h4, .cm-lsp-hover h5, .cm-lsp-hover h6":
          {
            margin: "0 0 8px",
            color: theme.foreground,
            fontWeight: "600",
            lineHeight: "1.35",
          },
        ".cm-lsp-hover h1": { fontSize: "1.35em" },
        ".cm-lsp-hover h2": { fontSize: "1.25em" },
        ".cm-lsp-hover h3": { fontSize: "1.1em" },
        ".cm-lsp-hover p": { margin: "0 0 8px" },
        ".cm-lsp-hover p:last-child": { marginBottom: "0" },
        ".cm-lsp-hover hr": {
          height: "1px",
          margin: "8px 0",
          border: "0",
          backgroundColor: theme.border,
        },
        ".cm-lsp-hover pre": {
          margin: "8px 0 0",
          overflowX: "auto",
          padding: "8px",
          border: `1px solid ${theme.border}`,
          borderRadius: "6px",
          backgroundColor: theme.codeBackground,
          fontFamily: theme.monoFont,
          lineHeight: "1.45",
          whiteSpace: "pre",
        },
        ".cm-lsp-hover code": {
          padding: "1px 4px",
          borderRadius: "4px",
          backgroundColor: theme.codeBackground,
          fontFamily: theme.monoFont,
        },
        ".cm-lsp-hover pre code": {
          padding: "0",
          borderRadius: "0",
          backgroundColor: "transparent",
        },
        ".cm-lsp-hover ul, .cm-lsp-hover ol": {
          margin: "4px 0 8px",
          paddingLeft: "20px",
        },
        ".cm-lsp-hover blockquote": {
          margin: "8px 0",
          paddingLeft: "8px",
          borderLeft: `2px solid ${theme.border}`,
          color: theme.foregroundMuted,
        },
        ".cm-lsp-hover a": {
          color: theme.foreground,
          textDecoration: "underline",
          textUnderlineOffset: "2px",
        },
        "&.cm-focused": { outline: "none" },
      },
      { dark: theme.colorScheme === "dark" },
    ),
    syntaxHighlighting(createCodeMirrorHighlightStyle(theme.syntax)),
  ];
}
