import { describe, expect, test } from "bun:test";
import { parseNdjsonLine } from "../../src/plugins/code-executor/ndjson-parser";

describe("parseNdjsonLine", () => {
  test("parses system init message", () => {
    const line = JSON.stringify({ type: "system", subtype: "init" });
    expect(parseNdjsonLine(line)).toEqual({ type: "system", subtype: "init" });
  });

  test("parses assistant message with text content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    expect(parseNdjsonLine(line)).toEqual({
      type: "assistant",
      text: "Hello world",
    });
  });

  test("parses assistant message with tool_use — extracts tool names", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Running code" },
          { type: "tool_use", name: "Bash" },
          { type: "tool_use", name: "Read" },
        ],
      },
    });
    expect(parseNdjsonLine(line)).toEqual({
      type: "assistant",
      text: "Running code [Bash, Read]",
    });
  });

  test("parses result success message", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Task completed",
      is_error: false,
    });
    const result = parseNdjsonLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("result");
    expect(result!.subtype).toBe("success");
    expect(result!.text).toBe("Task completed");
    expect(result!.isError).toBe(false);
  });

  test("parses result error message", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error",
      result: "Something went wrong",
      is_error: true,
    });
    const result = parseNdjsonLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("result");
    expect(result!.isError).toBe(true);
    expect(result!.text).toBe("Something went wrong");
  });

  test("extracts duration, turns, cost from result", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Done",
      is_error: false,
      duration_ms: 1234,
      num_turns: 3,
      total_cost_usd: 0.05,
    });
    const result = parseNdjsonLine(line);
    expect(result).not.toBeNull();
    expect(result!.durationMs).toBe(1234);
    expect(result!.numTurns).toBe(3);
    expect(result!.costUsd).toBe(0.05);
  });

  test("returns null for empty line", () => {
    expect(parseNdjsonLine("")).toBeNull();
    expect(parseNdjsonLine("   ")).toBeNull();
    expect(parseNdjsonLine("\n")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseNdjsonLine("{not json}")).toBeNull();
    expect(parseNdjsonLine("just a string")).toBeNull();
  });

  test("returns null for unknown type", () => {
    const line = JSON.stringify({ type: "unknown", data: "something" });
    expect(parseNdjsonLine(line)).toBeNull();
  });
});
