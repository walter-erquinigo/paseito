import type MarkdownIt = require("markdown-it");
import { describe, expect, it } from "vitest";
import { createMarkdownFilePreviewParser } from "./markdown-file-links";

const WORKSPACE_ROOT = "/Users/test/project";

interface ParsedLink {
  href: string | null;
  info: string;
  childTypes: string[];
  text: string;
}

function parseLinks(markdown: string): ParsedLink[] {
  const tokens = createMarkdownFilePreviewParser(WORKSPACE_ROOT).parse(markdown, {});
  const links: ParsedLink[] = [];
  for (const token of tokens) {
    const children = token.children ?? [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child?.type !== "link_open") continue;
      const linkChildren: MarkdownIt.Token[] = [];
      for (
        index += 1;
        index < children.length && children[index]?.type !== "link_close";
        index += 1
      ) {
        const linkChild = children[index];
        if (linkChild) linkChildren.push(linkChild);
      }
      links.push({
        href: child.attrGet("href"),
        info: child.info,
        childTypes: linkChildren.map((entry) => entry.type),
        text: linkChildren.map((entry) => entry.content).join(""),
      });
    }
  }
  return links;
}

describe("createMarkdownFilePreviewParser", () => {
  it("links relative and absolute prose locations while excluding sentence punctuation", () => {
    expect(
      parseLinks(
        "See src/app.ts:10-14, missing.ts:9-12, then /tmp/outside.ts:7:2. Also src/range.ts#L2-L5.",
      ),
    ).toEqual([
      {
        href: "src/app.ts:10-14",
        info: "paseito-file-preview",
        childTypes: ["text"],
        text: "src/app.ts:10-14",
      },
      {
        href: "missing.ts:9-12",
        info: "paseito-file-preview",
        childTypes: ["text"],
        text: "missing.ts:9-12",
      },
      {
        href: "/tmp/outside.ts:7:2",
        info: "paseito-file-preview",
        childTypes: ["text"],
        text: "/tmp/outside.ts:7:2",
      },
      {
        href: "src/range.ts#L2-L5",
        info: "paseito-file-preview",
        childTypes: ["text"],
        text: "src/range.ts#L2-L5",
      },
    ]);
  });

  it("links an entire inline-code location and an explicit word range", () => {
    expect(parseLinks("Open `src/app.ts(10,4)` or src/range.ts lines 2-5.")).toEqual([
      {
        href: "src/app.ts(10,4)",
        info: "paseito-file-preview",
        childTypes: ["code_inline"],
        text: "src/app.ts(10,4)",
      },
      {
        href: "src/range.ts lines 2-5",
        info: "paseito-file-preview",
        childTypes: ["text"],
        text: "src/range.ts lines 2-5",
      },
    ]);
  });

  it("keeps explicit Markdown links and web URLs as single links", () => {
    const links = parseLinks(
      "[source](src/app.ts:10:4), [spaced](<src/my file.ts:8:3>), and https://example.com/app.ts:10-4",
    );
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({ href: "src/app.ts:10:4", text: "source" });
    expect(links[1]).toMatchObject({ href: "src/my%20file.ts:8:3", text: "spaced" });
    expect(links[2]).toMatchObject({
      href: "https://example.com/app.ts:10-4",
      text: "https://example.com/app.ts:10-4",
    });
    expect(links[2]?.info).not.toBe("paseito-file-preview");
  });

  it("leaves fenced code, plain file prose, and unrelated prose untouched", () => {
    expect(
      parseLinks(
        ["README.md and ordinary prose stay plain.", "", "```text", "src/app.ts:10-14", "```"].join(
          "\n",
        ),
      ),
    ).toEqual([]);
  });
});
