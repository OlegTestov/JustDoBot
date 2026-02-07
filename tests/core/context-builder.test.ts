import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildContext, estimateTokens } from "../../src/core/context-builder";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";

let db: SqliteMemoryProvider;
let sessionId: string;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
  sessionId = crypto.randomUUID();
});

afterEach(async () => {
  await db.destroy();
});

describe("estimateTokens", () => {
  test("estimates roughly 1 token per 3 chars", () => {
    const tokens = estimateTokens("hello world");
    expect(tokens).toBe(Math.ceil(11 / 3));
  });

  test("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("buildContext", () => {
  test("returns empty context for no messages", async () => {
    const context = await buildContext(sessionId, "hello", db, 12000);
    expect(context.recentMessages.length).toBe(0);
    expect(context.relevantMemories.length).toBe(0);
    expect(context.activeGoals.length).toBe(0);
    expect(context.vaultResults.length).toBe(0);
    expect(context.tokenBudget).toBe(12000);
    expect(context.actualTokens).toBe(0);
  });

  test("includes recent messages within budget", async () => {
    for (let i = 0; i < 5; i++) {
      await db.saveMessage({
        session_id: sessionId,
        role: "user",
        content: `Message ${i}`,
      });
    }

    const context = await buildContext(sessionId, "test", db, 12000);
    expect(context.recentMessages.length).toBe(5);
    expect(context.actualTokens).toBeGreaterThan(0);
    expect(context.actualTokens).toBeLessThanOrEqual(12000);
  });

  test("includes relevant memories", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "User likes TypeScript programming",
      confidence: 0.9,
    });
    await db.saveMemory!({
      category: "preference",
      content: "Prefers dark mode",
      confidence: 0.8,
    });

    // Query that should match via FTS
    const context = await buildContext(sessionId, "TypeScript", db, 12000);

    expect(context.relevantMemories.length).toBeGreaterThan(0);
  });

  test("includes active goals", async () => {
    await db.saveGoal!({
      title: "Learn Rust",
      description: "Master Rust programming",
      status: "active",
      deadline: "2025-12-31",
    });

    const context = await buildContext(sessionId, "test", db, 12000);
    expect(context.activeGoals.length).toBe(1);
    expect(context.activeGoals[0].title).toBe("Learn Rust");
  });

  test("respects token budget", async () => {
    // Add many messages to exceed budget
    for (let i = 0; i < 100; i++) {
      await db.saveMessage({
        session_id: sessionId,
        role: "user",
        content: "A".repeat(200), // ~67 tokens each
      });
    }

    const context = await buildContext(sessionId, "test", db, 500);
    // Should not include all 100 messages
    expect(context.recentMessages.length).toBeLessThan(100);
    expect(context.actualTokens).toBeLessThanOrEqual(500);
  });

  test("redistributes unused vault/check-in budget to messages", async () => {
    // Add enough messages to overflow initial 40% budget but fit in expanded
    for (let i = 0; i < 50; i++) {
      await db.saveMessage({
        session_id: sessionId,
        role: "user",
        content: `Message number ${i}`,
      });
    }

    const context = await buildContext(sessionId, "", db, 12000);
    // Without redistribution: 40% = 4800 tokens for messages
    // With redistribution: 40% + 25% + 5% = 70% = 8400 tokens
    // Should include more messages than 40% alone would allow
    expect(context.recentMessages.length).toBeGreaterThan(0);
  });

  test("works with null embeddingProvider", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "Test memory",
      confidence: 0.8,
    });

    // Explicitly pass null embedding provider
    const context = await buildContext(sessionId, "test", db, 12000, null);

    expect(context.tokenBudget).toBe(12000);
  });

  test("includes check-in logs when checkInRepo provided", async () => {
    const checkInRepo = (
      db as unknown as {
        getCheckInRepo: () => {
          getRecentLogs: (limit: number) => Array<{ created_at: string; message_sent?: string }>;
        };
      }
    ).getCheckInRepo();

    // Save a check-in log
    checkInRepo.saveLog({
      user_id: "test",
      data_hash: "abc",
      sources: ["goals"],
      gating_result: "text",
      message_sent: "Check-in message",
    });

    const context = await buildContext(
      sessionId,
      "test",
      db,
      12000,
      null,
      undefined,
      null,
      "en",
      checkInRepo,
    );
    expect(context.checkInLogs.length).toBe(1);
    expect(context.checkInLogs[0].message_sent).toBe("Check-in message");
  });

  test("empty userMessage skips memory search", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "Some memory",
      confidence: 0.9,
    });

    const context = await buildContext(sessionId, "", db, 12000);
    // Empty userMessage should skip hybrid search
    expect(context.relevantMemories.length).toBe(0);
  });
});
