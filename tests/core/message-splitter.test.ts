import { describe, expect, test } from "bun:test";
import { splitMessage } from "../../src/core/message-splitter";

describe("splitMessage", () => {
  test("short text returns single part", () => {
    expect(splitMessage("Hello world")).toEqual(["Hello world"]);
  });

  test("text exactly at limit returns single part", () => {
    const text = "A".repeat(4096);
    expect(splitMessage(text)).toEqual([text]);
  });

  test("splits at double newline", () => {
    const part1 = "A".repeat(3000);
    const part2 = "B".repeat(3000);
    const text = `${part1}\n\n${part2}`;
    const parts = splitMessage(text);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(part1);
    expect(parts[1]).toBe(part2);
  });

  test("splits at single newline when no double newline", () => {
    const part1 = "A".repeat(3000);
    const part2 = "B".repeat(3000);
    const text = `${part1}\n${part2}`;
    const parts = splitMessage(text);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(part1);
    expect(parts[1]).toBe(part2);
  });

  test("hard splits when no split points", () => {
    const text = "A".repeat(8192);
    const parts = splitMessage(text);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(4096);
    expect(parts[1].length).toBe(4096);
  });

  test("handles Unicode text (Russian)", () => {
    const text = "Привет мир! ".repeat(500);
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThanOrEqual(1);
    expect(parts.join("").length).toBe(text.length);
  });

  test("empty string returns single part", () => {
    expect(splitMessage("")).toEqual([""]);
  });

  test("prefers double newline over single newline", () => {
    const text = `${"A".repeat(2000)}\n${"B".repeat(1000)}\n\n${"C".repeat(2000)}`;
    const parts = splitMessage(text);
    // Should split at \n\n since it's within range
    expect(parts[0]).toBe(`${"A".repeat(2000)}\n${"B".repeat(1000)}`);
    expect(parts[1]).toBe("C".repeat(2000));
  });
});
