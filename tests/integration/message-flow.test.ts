import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { buildContext } from "../../src/core/context-builder";
import { MessageQueue } from "../../src/core/message-queue";
import { splitMessage } from "../../src/core/message-splitter";
import { SessionManager } from "../../src/core/session-manager";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";

describe("Message Flow Integration", () => {
  test("SQLite: save and retrieve messages", async () => {
    const db = new SqliteMemoryProvider();
    await db.init({
      database: { path: ":memory:" },
    } as Record<string, unknown>);

    const sessionId = crypto.randomUUID();

    await db.saveMessage({
      session_id: sessionId,
      role: "user",
      content: "Hello bot!",
      telegram_message_id: 1,
    });

    await db.saveMessage({
      session_id: sessionId,
      role: "assistant",
      content: "Hello! How can I help?",
    });

    const messages = await db.getRecentMessages(10, sessionId);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello bot!");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hello! How can I help?");

    await db.destroy();
  });

  test("MessageQueue: sequential processing", async () => {
    const queue = new MessageQueue();
    const order: number[] = [];

    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
    });

    await queue.drain();
    expect(order).toEqual([1, 2]);
  });

  test("SessionManager + DB: context building", async () => {
    const db = new SqliteMemoryProvider();
    await db.init({
      database: { path: ":memory:" },
    } as Record<string, unknown>);

    const sm = new SessionManager(6);
    const sessionId = sm.getSessionId(123);

    await db.saveMessage({
      session_id: sessionId,
      role: "user",
      content: "What is 2+2?",
    });

    const context = await buildContext(sessionId, "", db, 12000);
    expect(context.recentMessages.length).toBe(1);
    expect(context.recentMessages[0].content).toBe("What is 2+2?");
    expect(context.actualTokens).toBeGreaterThan(0);
    expect(context.actualTokens).toBeLessThanOrEqual(context.tokenBudget);

    await db.destroy();
  });

  test("FTS5: full-text search works", async () => {
    const db = new SqliteMemoryProvider();
    await db.init({
      database: { path: ":memory:" },
    } as Record<string, unknown>);

    const sessionId = crypto.randomUUID();

    await db.saveMessage({
      session_id: sessionId,
      role: "user",
      content: "I need help with TypeScript generics",
    });

    await db.saveMessage({
      session_id: sessionId,
      role: "assistant",
      content: "TypeScript generics allow you to create reusable components",
    });

    // Verify FTS5 works via raw DB access
    // @ts-expect-error accessing private for testing
    const rawDb = db.db as Database;
    const results = rawDb
      .prepare("SELECT * FROM fts_messages WHERE fts_messages MATCH 'TypeScript'")
      .all();
    expect(results.length).toBe(2);

    await db.destroy();
  });

  test("message splitter integration", () => {
    const longResponse = `Line ${"A".repeat(4000)}\n\nSecond part ${"B".repeat(4000)}`;
    const parts = splitMessage(longResponse);
    expect(parts.length).toBe(2);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });
});
