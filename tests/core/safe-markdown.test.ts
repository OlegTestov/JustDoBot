import { describe, expect, test } from "bun:test";
import { escapeMarkdownV2 } from "../../src/core/safe-markdown";

describe("escapeMarkdownV2", () => {
  test("escapes all special characters", () => {
    const special = "_*[]()~`>#+-=|{}.!\\";
    const escaped = escapeMarkdownV2(special);
    expect(escaped).toBe("\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\");
  });

  test("empty string returns empty string", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });

  test("regular text passes through unchanged", () => {
    expect(escapeMarkdownV2("Hello world")).toBe("Hello world");
  });

  test("mixed text with special chars", () => {
    expect(escapeMarkdownV2("Price: $100.50!")).toBe("Price: $100\\.50\\!");
  });

  test("Russian text passes through", () => {
    expect(escapeMarkdownV2("Привет мир")).toBe("Привет мир");
  });

  test("escapes dots in URLs", () => {
    expect(escapeMarkdownV2("example.com")).toBe("example\\.com");
  });
});
