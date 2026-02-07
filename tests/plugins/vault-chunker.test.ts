import { describe, expect, test } from "bun:test";
import { chunkDocument } from "../../src/plugins/vault/obsidian/chunker";

describe("chunkDocument", () => {
  test("short document returns single chunk", () => {
    const chunks = chunkDocument("Short content.");
    expect(chunks.length).toBe(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toBe("Short content.");
  });

  test("empty document returns no chunks", () => {
    const chunks = chunkDocument("");
    expect(chunks.length).toBe(0);
  });

  test("splits by ## headers", () => {
    const content = `# Title

Introduction paragraph.

## Section One

${"A".repeat(200)}

## Section Two

${"B".repeat(200)}

## Section Three

${"C".repeat(200)}`;

    const chunks = chunkDocument(content, { maxChunkSize: 300 });
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should have sequential indices
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  test("splits large sections by paragraphs", () => {
    const longSection =
      "## Big Section\n\n" +
      Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${"X".repeat(100)}`).join("\n\n");

    const chunks = chunkDocument(longSection, { maxChunkSize: 500 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("applies overlap between chunks", () => {
    const longSection =
      "## Section\n\n" +
      Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. ${"Y".repeat(200)}`).join("\n\n");

    const chunks = chunkDocument(longSection, {
      maxChunkSize: 500,
      overlapSize: 100,
    });

    // Verify overlap: end of chunk N should appear at start of chunk N+1
    if (chunks.length >= 2) {
      const endOfFirst = chunks[0].content.slice(-50);
      expect(chunks[1].content).toContain(endOfFirst);
    }
  });

  test("preserves header path", () => {
    const content = `## First Section

${"A".repeat(200)}

## Second Section

${"B".repeat(200)}`;

    const chunks = chunkDocument(content, { maxChunkSize: 300 });
    // Should have at least 2 chunks (one per section)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const headers = chunks.map((c) => c.headerPath);
    expect(headers).toContain("## First Section");
    expect(headers).toContain("## Second Section");
  });

  test("handles document with no ## headers", () => {
    const content = "# Title\n\nJust plain text without subsections.";
    const chunks = chunkDocument(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain("Just plain text");
  });

  test("filters out empty chunks", () => {
    const content =
      "## Section One\n\nContent.\n\n## Section Two\n\n   \n\n## Section Three\n\nMore content.";
    const chunks = chunkDocument(content, { maxChunkSize: 50 });
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});
