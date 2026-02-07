import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { VaultDocument } from "../../src/core/interfaces";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";

let db: SqliteMemoryProvider;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
});

afterEach(async () => {
  await db.destroy();
});

describe("VaultRepository", () => {
  const sampleDoc: VaultDocument = {
    file_path: "AI-Tools/video-tools.md",
    chunk_index: 0,
    title: "Video Tools",
    content: "List of AI video tools: Runway, Pika, Sora",
    content_hash: "abc123",
    metadata: JSON.stringify({ frontmatter: {} }),
  };

  test("upsertDocument returns ID", () => {
    const repo = db.getVaultRepo();
    const id = repo.upsertDocument(sampleDoc);
    expect(id).toBeGreaterThan(0);
  });

  test("upsertDocument updates on conflict", () => {
    const repo = db.getVaultRepo();
    repo.upsertDocument(sampleDoc);
    const updatedDoc = { ...sampleDoc, content: "Updated content", content_hash: "def456" };
    repo.upsertDocument(updatedDoc);

    const docs = repo.getDocumentsByPath("AI-Tools/video-tools.md");
    expect(docs.length).toBe(1);
    expect(docs[0].content).toBe("Updated content");
    expect(docs[0].content_hash).toBe("def456");
  });

  test("getHashByPath returns correct hash", () => {
    const repo = db.getVaultRepo();
    repo.upsertDocument(sampleDoc);

    const hash = repo.getHashByPath("AI-Tools/video-tools.md");
    expect(hash).toBe("abc123");
  });

  test("getHashByPath returns null for non-existent path", () => {
    const repo = db.getVaultRepo();
    const hash = repo.getHashByPath("non-existent.md");
    expect(hash).toBeNull();
  });

  test("deleteByPath removes all chunks", () => {
    const repo = db.getVaultRepo();
    repo.upsertDocument(sampleDoc);
    repo.upsertDocument({ ...sampleDoc, chunk_index: 1, content: "Chunk 2" });

    expect(repo.getDocumentsByPath("AI-Tools/video-tools.md").length).toBe(2);

    repo.deleteByPath("AI-Tools/video-tools.md");
    expect(repo.getDocumentsByPath("AI-Tools/video-tools.md").length).toBe(0);
  });

  test("deleteStaleChunks removes chunks beyond max index", () => {
    const repo = db.getVaultRepo();
    // Insert 3 chunks
    for (let i = 0; i < 3; i++) {
      repo.upsertDocument({ ...sampleDoc, chunk_index: i, content: `Chunk ${i}` });
    }

    // File shrank — now only has 1 chunk
    repo.deleteStaleChunks("AI-Tools/video-tools.md", 0);

    const docs = repo.getDocumentsByPath("AI-Tools/video-tools.md");
    expect(docs.length).toBe(1);
    expect(docs[0].chunk_index).toBe(0);
  });

  test("searchFTS finds by keyword", () => {
    const repo = db.getVaultRepo();
    repo.upsertDocument(sampleDoc);
    repo.upsertDocument({
      ...sampleDoc,
      file_path: "Books/rust-book.md",
      title: "Rust Book",
      content: "Rust programming language guide",
      content_hash: "xyz789",
    });

    const results = repo.searchFTS("video tools", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("video tools");
  });

  test("searchFTS handles special characters", () => {
    const repo = db.getVaultRepo();
    repo.upsertDocument(sampleDoc);

    // Should not throw on special FTS5 characters
    const results = repo.searchFTS("test \"query' with *special", 10);
    expect(Array.isArray(results)).toBe(true);
  });

  test("searchFTS returns empty for empty query", () => {
    const repo = db.getVaultRepo();
    repo.upsertDocument(sampleDoc);

    const results = repo.searchFTS("", 10);
    expect(results.length).toBe(0);
  });

  test("getDocumentCount returns correct count", () => {
    const repo = db.getVaultRepo();
    expect(repo.getDocumentCount()).toBe(0);

    repo.upsertDocument(sampleDoc);
    expect(repo.getDocumentCount()).toBe(1);

    repo.upsertDocument({ ...sampleDoc, chunk_index: 1, content: "Chunk 2" });
    expect(repo.getDocumentCount()).toBe(2);
  });

  test("multiple chunks per file are correctly stored", () => {
    const repo = db.getVaultRepo();

    for (let i = 0; i < 5; i++) {
      repo.upsertDocument({
        ...sampleDoc,
        chunk_index: i,
        content: `Chunk content ${i}`,
      });
    }

    const docs = repo.getDocumentsByPath("AI-Tools/video-tools.md");
    expect(docs.length).toBe(5);
    expect(docs[0].chunk_index).toBe(0);
    expect(docs[4].chunk_index).toBe(4);
  });
});
