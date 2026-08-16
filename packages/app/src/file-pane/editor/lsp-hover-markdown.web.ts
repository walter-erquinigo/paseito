import MarkdownIt from "markdown-it";
import type { WorkspaceLspHover } from "@getpaseo/protocol/messages";

const markdownParser = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: true,
});

markdownParser.renderer.rules.image = (tokens, index) =>
  markdownParser.utils.escapeHtml(tokens[index]?.content ?? "");

export interface LspHoverVisualTheme {
  border: string;
  codeBackground: string;
  codeFontSize: number;
  foreground: string;
  foregroundMuted: string;
  monoFont: string;
  surfaceRaised: string;
  uiFont: string;
}

export function createLspHoverMarkdownDom(
  hover: WorkspaceLspHover,
  visualTheme?: LspHoverVisualTheme,
): HTMLDivElement {
  const dom = document.createElement("div");
  dom.className = "cm-lsp-hover";
  const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];

  for (const content of contents) {
    const part = document.createElement("div");
    part.className = "cm-lsp-hover-part";

    if (typeof content === "string") {
      appendMarkdown(part, content);
    } else if ("language" in content) {
      appendCode(part, content.language, content.value);
    } else if (content.kind.toLowerCase() === "markdown") {
      appendMarkdown(part, content.value);
    } else {
      part.classList.add("cm-lsp-hover-plaintext");
      part.textContent = content.value;
    }

    dom.append(part);
  }

  if (visualTheme) styleLspHoverMarkdownDom(dom, visualTheme);

  return dom;
}

export function hasLspHoverContent(hover: WorkspaceLspHover): boolean {
  const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  return contents.some((content) => {
    const value = typeof content === "string" ? content : content.value;
    return value.trim().length > 0;
  });
}

function appendMarkdown(parent: HTMLElement, markdown: string): void {
  const template = document.createElement("template");
  template.innerHTML = markdownParser.render(markdown);
  parent.append(template.content);
}

function appendCode(parent: HTMLElement, language: string, code: string): void {
  const pre = document.createElement("pre");
  const codeElement = document.createElement("code");
  const normalizedLanguage = language
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_+#.-]/g, "-");
  if (normalizedLanguage) codeElement.className = `language-${normalizedLanguage}`;
  codeElement.textContent = code;
  pre.append(codeElement);
  parent.append(pre);
}

function styleLspHoverMarkdownDom(dom: HTMLDivElement, theme: LspHoverVisualTheme): void {
  applyStyle(dom, {
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
  });
  for (const part of Array.from(dom.children).slice(1)) {
    if (part instanceof HTMLElement) part.style.marginTop = "8px";
  }
  applyStyleToAll(dom, ".cm-lsp-hover-plaintext", { whiteSpace: "pre-wrap" });
  applyStyleToAll(dom, "h1, h2, h3, h4, h5, h6", {
    margin: "0 0 8px",
    color: theme.foreground,
    fontWeight: "600",
    lineHeight: "1.35",
  });
  applyStyleToAll(dom, "h1", { fontSize: "1.35em" });
  applyStyleToAll(dom, "h2", { fontSize: "1.25em" });
  applyStyleToAll(dom, "h3", { fontSize: "1.1em" });
  applyStyleToAll(dom, "p", { margin: "0 0 8px" });
  applyStyleToAll(dom, ".cm-lsp-hover-part p:last-child", { marginBottom: "0" });
  applyStyleToAll(dom, "hr", {
    height: "1px",
    margin: "8px 0",
    border: "0",
    backgroundColor: theme.border,
  });
  applyStyleToAll(dom, "pre", {
    margin: "8px 0 0",
    overflowX: "auto",
    padding: "8px",
    border: `1px solid ${theme.border}`,
    borderRadius: "6px",
    backgroundColor: theme.codeBackground,
    fontFamily: theme.monoFont,
    lineHeight: "1.45",
    whiteSpace: "pre",
  });
  applyStyleToAll(dom, "code", {
    padding: "1px 4px",
    borderRadius: "4px",
    backgroundColor: theme.codeBackground,
    fontFamily: theme.monoFont,
  });
  applyStyleToAll(dom, "pre code", {
    padding: "0",
    borderRadius: "0",
    backgroundColor: "transparent",
  });
  applyStyleToAll(dom, "ul, ol", { margin: "4px 0 8px", paddingLeft: "20px" });
  applyStyleToAll(dom, "blockquote", {
    margin: "8px 0",
    paddingLeft: "8px",
    borderLeft: `2px solid ${theme.border}`,
    color: theme.foregroundMuted,
  });
  applyStyleToAll(dom, "a", {
    color: theme.foreground,
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  });
}

function applyStyleToAll(
  parent: ParentNode,
  selector: string,
  style: Partial<CSSStyleDeclaration>,
): void {
  for (const element of parent.querySelectorAll(selector)) {
    if (element instanceof HTMLElement) applyStyle(element, style);
  }
}

function applyStyle(element: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, style);
}
