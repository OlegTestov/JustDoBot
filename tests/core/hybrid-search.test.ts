import { describe, expect, test } from "bun:test";
import { hybridSearchMemories } from "../../src/core/hybrid-search";
import type { HybridSearchResult, IMemoryProvider, Memory } from "../../src/core/interfaces";

function createMockDb(
  memories: Memory[],
  ftsResults: HybridSearchResult[] = [],
  semanticResults: Array<{ id: number; distance: number }> = [],
): IMemoryProvider {
  return {
    name: "mock",
    version: "1.0.0",
    async init() {},
    async destroy() {},
    async healthCheck() {
      return { healthy: true, lastCheck: new Date() };
    },
    async saveMessage() {},
    async getRecentMessages() {
      return [];
    },
    async getLastMessageTime() {
      return null;
    },
    async flush() {},
    async getMemories() {
      return memories;
    },
    async searchMemoriesHybrid() {
      return ftsResults;
    },
    async searchSemanticMemories() {
      return semanticResults;
    },
  };
}

describe("hybridSearchMemories", () => {
  test("keyword-only mode when no embedding", async () => {
    const memories: Memory[] = [
      {
        id: 1,
        category: "fact",
        content: "Likes TypeScript",
        confidence: 0.9,
        created_at: new Date().toISOString(),
      },
    ];
    const ftsResults: HybridSearchResult[] = [
      { id: 1, content: "Likes TypeScript", score: 0, source: "memory" },
    ];

    const db = createMockDb(memories, ftsResults);
    const results = await hybridSearchMemories(db, {
      query: "TypeScript",
      embedding: null,
      limit: 10,
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("returns empty for no matches", async () => {
    const db = createMockDb([], []);
    const results = await hybridSearchMemories(db, {
      query: "nonexistent",
      embedding: null,
      limit: 10,
    });

    expect(results.length).toBe(0);
  });

  test("recency scoring: recent items score higher", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    const memories: Memory[] = [
      {
        id: 1,
        category: "fact",
        content: "Recent fact",
        confidence: 0.9,
        created_at: now.toISOString(),
      },
      {
        id: 2,
        category: "fact",
        content: "Old fact",
        confidence: 0.9,
        created_at: old.toISOString(),
      },
    ];
    const ftsResults: HybridSearchResult[] = [
      { id: 1, content: "Recent fact", score: 0, source: "memory" },
      { id: 2, content: "Old fact", score: 0, source: "memory" },
    ];

    const db = createMockDb(memories, ftsResults);
    const results = await hybridSearchMemories(db, {
      query: "fact",
      embedding: null,
      limit: 10,
    });

    expect(results.length).toBe(2);
    // Recent item should have higher score
    const recent = results.find((r) => r.id === 1)!;
    const old_result = results.find((r) => r.id === 2)!;
    expect(recent.score).toBeGreaterThan(old_result.score);
  });

  test("respects limit parameter", async () => {
    const memories: Memory[] = [];
    const ftsResults: HybridSearchResult[] = [];
    for (let i = 1; i <= 10; i++) {
      memories.push({
        id: i,
        category: "fact",
        content: `Fact ${i}`,
        confidence: 0.8,
        created_at: new Date().toISOString(),
      });
      ftsResults.push({
        id: i,
        content: `Fact ${i}`,
        score: 0,
        source: "memory",
      });
    }

    const db = createMockDb(memories, ftsResults);
    const results = await hybridSearchMemories(db, {
      query: "fact",
      embedding: null,
      limit: 5,
    });

    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("custom weights override defaults", async () => {
    const memories: Memory[] = [
      {
        id: 1,
        category: "fact",
        content: "Test memory",
        confidence: 0.9,
        created_at: new Date().toISOString(),
      },
    ];
    const ftsResults: HybridSearchResult[] = [
      { id: 1, content: "Test memory", score: 0, source: "memory" },
    ];

    const db = createMockDb(memories, ftsResults);
    const results = await hybridSearchMemories(db, {
      query: "test",
      embedding: null,
      limit: 10,
      weights: { semantic: 0, keyword: 0.5, recency: 0.5 },
    });

    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});
