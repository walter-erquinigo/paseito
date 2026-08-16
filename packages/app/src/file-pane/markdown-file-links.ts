import MarkdownItLibrary from "markdown-it";
import type MarkdownItTypes = require("markdown-it");
import {
  isFileLookingAssistantToken,
  parseMarkdownPreviewFileLink,
} from "@/assistant-file-links/parse";

const PREVIEW_FILE_LINK_INFO = "paseito-file-preview";
const LOCATION_RUN_PATTERN = /\S+(?:[ \t]+lines?[ \t]+[0-9]+-[0-9]+[^\s]*)?/gi;
const LEADING_SENTENCE_PUNCTUATION = /^[[({<"']+/;
const TRAILING_SENTENCE_PUNCTUATION = /[.,;!?\]}>"')]+$/;

type MarkdownToken = MarkdownItTypes.Token;
type MarkdownTokenConstructor = new (
  type: string,
  tag: string,
  nesting: -1 | 0 | 1,
) => MarkdownToken;

export function createMarkdownFilePreviewParser(workspaceRoot: string): MarkdownItLibrary {
  const parser = new MarkdownItLibrary({ typographer: true, linkify: true });
  const defaultValidateLink = parser.validateLink.bind(parser);
  parser.validateLink = (url: string) =>
    parseMarkdownPreviewFileLink(url, { workspaceRoot }) !== null || defaultValidateLink(url);

  parser.core.ruler.before("linkify", PREVIEW_FILE_LINK_INFO, (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) {
        continue;
      }
      const Token = (state as unknown as { Token: MarkdownTokenConstructor }).Token;
      token.children = linkifyInlineLocationTokens(token.children, Token, workspaceRoot);
    }
  });
  parser.core.ruler.after("linkify", `${PREVIEW_FILE_LINK_INFO}-cleanup`, (state) => {
    for (const token of state.tokens) {
      if (token.type === "inline" && token.children) {
        token.children = unwrapBareFileAutoLinks(token.children);
      }
    }
  });

  return parser;
}

function linkifyInlineLocationTokens(
  tokens: MarkdownToken[],
  Token: MarkdownTokenConstructor,
  workspaceRoot: string,
): MarkdownToken[] {
  const result: MarkdownToken[] = [];
  let linkDepth = 0;

  for (const token of tokens) {
    if (token.type === "link_open") {
      linkDepth += 1;
      result.push(token);
      continue;
    }
    if (token.type === "link_close") {
      result.push(token);
      linkDepth = Math.max(0, linkDepth - 1);
      continue;
    }
    if (linkDepth > 0) {
      result.push(token);
      continue;
    }

    if (token.type === "code_inline") {
      const target = parseMarkdownPreviewFileLink(token.content, { workspaceRoot });
      if (target?.lineStart) {
        result.push(createLinkOpenToken(Token, token.content), token, createLinkCloseToken(Token));
      } else {
        result.push(token);
      }
      continue;
    }

    if (token.type === "text") {
      result.push(...linkifyTextToken(token, Token, workspaceRoot));
      continue;
    }

    result.push(token);
  }

  return result;
}

function unwrapBareFileAutoLinks(tokens: MarkdownToken[]): MarkdownToken[] {
  const result: MarkdownToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const open = tokens[index];
    const text = tokens[index + 1];
    const close = tokens[index + 2];
    const isBareFileAutoLink =
      open?.type === "link_open" &&
      open.info === "auto" &&
      text?.type === "text" &&
      close?.type === "link_close" &&
      !text.content.includes("://") &&
      isFileLookingAssistantToken(text.content);
    if (isBareFileAutoLink && text) {
      result.push(text);
      index += 2;
      continue;
    }
    if (open) result.push(open);
  }
  return result;
}

function linkifyTextToken(
  token: MarkdownToken,
  Token: MarkdownTokenConstructor,
  workspaceRoot: string,
): MarkdownToken[] {
  const result: MarkdownToken[] = [];
  let cursor = 0;

  for (const match of token.content.matchAll(LOCATION_RUN_PATTERN)) {
    const rawRun = match[0];
    const runStart = match.index;
    if (runStart === undefined) {
      continue;
    }
    const location = extractLocationFromRun(rawRun, workspaceRoot);
    if (!location) {
      continue;
    }

    const linkStart = runStart + location.start;
    const linkEnd = runStart + location.end;
    pushTextToken(result, Token, token.content.slice(cursor, linkStart));
    result.push(
      createLinkOpenToken(Token, location.value),
      createTextToken(Token, location.value),
      createLinkCloseToken(Token),
    );
    cursor = linkEnd;
  }

  if (result.length === 0) {
    return [token];
  }
  pushTextToken(result, Token, token.content.slice(cursor));
  return result;
}

function extractLocationFromRun(
  rawRun: string,
  workspaceRoot: string,
): { value: string; start: number; end: number } | null {
  const leading = rawRun.match(LEADING_SENTENCE_PUNCTUATION)?.[0].length ?? 0;
  const candidate = rawRun.slice(leading);
  const trailingPunctuation = candidate.match(TRAILING_SENTENCE_PUNCTUATION)?.[0] ?? "";

  for (let removed = 0; removed <= trailingPunctuation.length; removed += 1) {
    const end = rawRun.length - removed;
    const value = rawRun.slice(leading, end);
    const target = parseMarkdownPreviewFileLink(value, { workspaceRoot });
    if (target?.lineStart) {
      return { value, start: leading, end };
    }
  }

  return null;
}

function createLinkOpenToken(Token: MarkdownTokenConstructor, href: string): MarkdownToken {
  const token = new Token("link_open", "a", 1);
  token.attrs = [["href", href]];
  token.markup = "linkify";
  token.info = PREVIEW_FILE_LINK_INFO;
  return token;
}

function createLinkCloseToken(Token: MarkdownTokenConstructor): MarkdownToken {
  const token = new Token("link_close", "a", -1);
  token.markup = "linkify";
  token.info = PREVIEW_FILE_LINK_INFO;
  return token;
}

function createTextToken(Token: MarkdownTokenConstructor, content: string): MarkdownToken {
  const token = new Token("text", "", 0);
  token.content = content;
  return token;
}

function pushTextToken(
  result: MarkdownToken[],
  Token: MarkdownTokenConstructor,
  content: string,
): void {
  if (content) {
    result.push(createTextToken(Token, content));
  }
}
