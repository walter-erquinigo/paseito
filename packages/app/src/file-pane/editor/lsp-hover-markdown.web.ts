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

export function createLspHoverMarkdownDom(hover: WorkspaceLspHover): HTMLDivElement {
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
