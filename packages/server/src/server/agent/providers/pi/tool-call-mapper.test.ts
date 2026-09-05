import { describe, expect, test } from "vitest";

import { mapToolDetail, parseToolArgs, parseToolResult } from "./tool-call-mapper.js";

describe("Pi tool call mapper", () => {
  test("maps bash args and result to shell detail", () => {
    const toolCall = parseToolArgs("bash", { command: "echo hello" });
    const result = parseToolResult({ output: "hello\n", exitCode: 0 });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "shell",
      command: "echo hello",
      output: "hello\n",
      exitCode: 0,
    });
  });

  test("maps legacy edit args to edit detail with diff", () => {
    const toolCall = parseToolArgs("edit", {
      path: "app.ts",
      old_string: "before",
      new_string: "after",
    });
    const result = parseToolResult({ details: { diff: "-before\n+after" } });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "edit",
      filePath: "app.ts",
      oldString: "before",
      newString: "after",
      unifiedDiff: "-before\n+after",
    });
  });

  test("preserves ordinary writes as write details", () => {
    const toolCall = parseToolArgs("write", {
      path: "notes.txt",
      content: "unchanged\n",
    });

    expect(mapToolDetail(toolCall, parseToolResult({ text: "Wrote notes.txt" }))).toEqual({
      type: "write",
      filePath: "notes.txt",
      content: "unchanged\n",
    });
  });

  test("maps completed Pi plans to the shared plan presentation", () => {
    const toolCall = parseToolArgs("plan_mode_complete", {
      plan: "\n# Proposed change\n\n- Update the mapper\n",
    });
    const result = parseToolResult({
      content: [{ type: "text", text: "**Proposed Plan**\n\n# Proposed change" }],
    });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "plan",
      text: "# Proposed change\n\n- Update the mapper",
    });
  });

  test("preserves malformed Pi plan and unknown tool details", () => {
    const malformedPlan = parseToolArgs("plan_mode_complete", { plan: "  " });
    expect(mapToolDetail(malformedPlan, null)).toEqual({
      type: "unknown",
      input: { plan: "  " },
      output: null,
    });

    const toolCall = parseToolArgs("custom_tool", { value: 42 });
    const result = parseToolResult({ text: "custom result" });
    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { value: 42 },
      output: { text: "custom result" },
    });
  });
});
