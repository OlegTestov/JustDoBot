import { describe, expect, test } from "bun:test";
import { parseMarkdown, resolveWikiLinks } from "../../src/plugins/vault/obsidian/parser";

describe("parseMarkdown", () => {
  test("parses frontmatter and content", () => {
    const raw = `---
title: My Note
tags: [test]
---

# Heading

Some content here.`;

    const result = parseMarkdown(raw, "test.md");
    expect(result.frontmatter.title).toBe("My Note");
    expect(result.frontmatter.tags).toEqual(["test"]);
    expect(result.title).toBe("My Note");
    expect(result.content).toContain("Some content here.");
    expect(result.content).not.toContain("---");
  });

  test("parses markdown without frontmatter", () => {
    const raw = `# My Title

Content without frontmatter.`;

    const result = parseMarkdown(raw, "no-fm.md");
    expect(result.frontmatter).toEqual({});
    expect(result.title).toBe("My Title");
    expect(result.content).toContain("Content without frontmatter.");
  });

  test("falls back to filename for title", () => {
    const raw = "Just some text without headers.";
    const result = parseMarkdown(raw, "my-note.md");
    expect(result.title).toBe("my-note");
  });

  test("extracts wiki-links", () => {
    const raw = `Some text with [[Link One]] and [[Link Two|Alias]].
Also [[Link One]] again (duplicate).`;

    const result = parseMarkdown(raw, "test.md");
    expect(result.wikiLinks).toEqual(["Link One", "Link Two"]);
  });

  test("handles empty file", () => {
    const result = parseMarkdown("", "empty.md");
    expect(result.title).toBe("empty");
    expect(result.content).toBe("");
    expect(result.wikiLinks).toEqual([]);
    expect(result.frontmatter).toEqual({});
  });

  test("handles invalid YAML frontmatter gracefully", () => {
    const raw = `---
{{{{invalid
---

Content after bad frontmatter.`;

    const result = parseMarkdown(raw, "bad-fm.md");
    // Invalid YAML should be ignored, frontmatter stays empty object
    expect(Object.keys(result.frontmatter).length).toBe(0);
    expect(result.content).toContain("Content after bad frontmatter.");
  });

  test("title from frontmatter takes priority over H1", () => {
    const raw = `---
title: Frontmatter Title
---

# H1 Title

Content.`;

    const result = parseMarkdown(raw, "test.md");
    expect(result.title).toBe("Frontmatter Title");
  });

  test("strips extension from filename fallback", () => {
    const result = parseMarkdown("no title here", "Documents/report.md");
    expect(result.title).toBe("report");
  });
});

describe("resolveWikiLinks", () => {
  test("replaces [[Link]] with plain text", () => {
    expect(resolveWikiLinks("See [[My Note]] for details.")).toBe("See My Note for details.");
  });

  test("replaces [[Link|Alias]] with alias", () => {
    expect(resolveWikiLinks("Visit [[Page|Home Page]].")).toBe("Visit Home Page.");
  });

  test("handles multiple links", () => {
    expect(resolveWikiLinks("[[A]], [[B|C]], and [[D]]")).toBe("A, C, and D");
  });

  test("returns text unchanged when no links", () => {
    expect(resolveWikiLinks("No links here.")).toBe("No links here.");
  });
});
