import { describe, expect, test } from "vitest";
import type { WorkspaceLspHover } from "@getpaseo/protocol/messages";
import { createLspHoverMarkdownDom } from "./lsp-hover-markdown.web";

describe("LSP hover Markdown", () => {
  test("renders clangd Markdown as semantic hover content", () => {
    const hover: WorkspaceLspHover = {
      contents: {
        kind: "markdown",
        value: [
          "### class `DITType`",
          "",
          "---",
          "",
          "Size: 8 bytes, alignment 8 bytes  ",
          "This class describes a debug info type.",
          "",
          "---",
          "",
          "```cpp",
          "class DITType : public Type {};",
          "```",
        ].join("\n"),
      },
    };

    const dom = createLspHoverMarkdownDom(hover);

    expect(dom.querySelector("h3")?.textContent).toBe("class DITType");
    expect(dom.querySelectorAll("hr")).toHaveLength(2);
    expect(dom.querySelector("h3 code")?.textContent).toBe("DITType");
    expect(dom.querySelector("pre code.language-cpp")?.textContent).toBe(
      "class DITType : public Type {};\n",
    );
    expect(dom.textContent).not.toContain("###");
    expect(dom.textContent).not.toContain("```cpp");
  });

  test("keeps plaintext and legacy language blocks literal", () => {
    const hover: WorkspaceLspHover = {
      contents: [
        { kind: "plaintext", value: "# literal *text* <script>alert(1)</script>" },
        { language: "cpp", value: "template <typename T>\nT value();" },
      ],
    };

    const dom = createLspHoverMarkdownDom(hover);

    expect(dom.querySelector("h1")).toBeNull();
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector(".cm-lsp-hover-plaintext")?.textContent).toBe(
      "# literal *text* <script>alert(1)</script>",
    );
    expect(dom.querySelector("pre code.language-cpp")?.textContent).toBe(
      "template <typename T>\nT value();",
    );
  });

  test("does not allow Markdown HTML or remote images to create active elements", () => {
    const hover: WorkspaceLspHover = {
      contents: {
        kind: "markdown",
        value:
          '<img src="https://example.com/tracker.png">\n\n![tracker](https://example.com/a.png)',
      },
    };

    const dom = createLspHoverMarkdownDom(hover);

    expect(dom.querySelector("img")).toBeNull();
    expect(dom.textContent).toContain("<img src=");
    expect(dom.textContent).toContain("https://example.com/tracker.png");
    expect(dom.textContent).toContain("tracker");
  });
});
