import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CheckInRepository } from "../../src/plugins/database/sqlite/check-ins";
import { STAGE4_DDL_CORE } from "../../src/plugins/database/sqlite/schema-stage4";

let db: Database;
let repo: CheckInRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(STAGE4_DDL_CORE);
  repo = new CheckInRepository(db);
});

afterEach(() => {
  db.close();
});

describe("CheckInRepository", () => {
  describe("saveLog / getRecentLogs", () => {
    test("saves and retrieves a log", () => {
      const id = repo.saveLog({
        user_id: "123",
        data_hash: "abc123",
        sources: ["goals", "vault"],
        gating_result: "text",
        urgency: 7,
        message_sent: "Hello!",
      });

      expect(id).toBeGreaterThan(0);

      const logs = repo.getRecentLogs(10);
      expect(logs.length).toBe(1);
      expect(logs[0].user_id).toBe("123");
      expect(logs[0].data_hash).toBe("abc123");
      expect(logs[0].sources).toEqual(["goals", "vault"]);
      expect(logs[0].gating_result).toBe("text");
      expect(logs[0].urgency).toBe(7);
      expect(logs[0].message_sent).toBe("Hello!");
      expect(logs[0].created_at).toBeDefined();
    });

    test("saves skip log", () => {
      repo.saveLog({
        user_id: "123",
        data_hash: "abc",
        sources: ["goals"],
        gating_result: "skip",
        skip_reason: "Data unchanged",
      });

      const logs = repo.getRecentLogs(1);
      expect(logs[0].gating_result).toBe("skip");
      expect(logs[0].skip_reason).toBe("Data unchanged");
      expect(logs[0].message_sent).toBeUndefined();
    });

    test("respects limit and orders by id DESC", () => {
      for (let i = 0; i < 5; i++) {
        repo.saveLog({
          user_id: "123",
          data_hash: `hash-${i}`,
          sources: ["goals"],
          gating_result: "skip",
          skip_reason: `Reason ${i}`,
        });
      }

      const logs = repo.getRecentLogs(3);
      expect(logs.length).toBe(3);
      // Most recent first
      expect(logs[0].data_hash).toBe("hash-4");
      expect(logs[1].data_hash).toBe("hash-3");
      expect(logs[2].data_hash).toBe("hash-2");
    });
  });

  describe("getLastSentTime", () => {
    test("returns null when no sent messages", () => {
      expect(repo.getLastSentTime()).toBeNull();
    });

    test("returns null when only skip logs exist", () => {
      repo.saveLog({
        data_hash: "abc",
        sources: ["goals"],
        gating_result: "skip",
        skip_reason: "test",
      });
      expect(repo.getLastSentTime()).toBeNull();
    });

    test("returns timestamp of last sent message", () => {
      repo.saveLog({
        data_hash: "abc",
        sources: ["goals"],
        gating_result: "text",
        message_sent: "Hello",
      });

      const time = repo.getLastSentTime();
      expect(time).not.toBeNull();
      expect(typeof time).toBe("string");
    });
  });

  describe("quiet mode", () => {
    test("setQuietMode + isQuietMode returns true for future time", () => {
      const future = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      repo.setQuietMode("user1", future);
      expect(repo.isQuietMode("user1")).toBe(true);
    });

    test("isQuietMode returns false for expired time", () => {
      const past = new Date(Date.now() - 1000).toISOString();
      repo.setQuietMode("user1", past);
      expect(repo.isQuietMode("user1")).toBe(false);
    });

    test("isQuietMode returns false for unknown user", () => {
      expect(repo.isQuietMode("unknown")).toBe(false);
    });

    test("clearQuietMode removes entry", () => {
      const future = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      repo.setQuietMode("user1", future);
      expect(repo.isQuietMode("user1")).toBe(true);

      repo.clearQuietMode("user1");
      expect(repo.isQuietMode("user1")).toBe(false);
    });

    test("setQuietMode upserts on conflict", () => {
      const future1 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const future2 = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      repo.setQuietMode("user1", future1);
      repo.setQuietMode("user1", future2);

      // Should still have only one entry, not throw
      expect(repo.isQuietMode("user1")).toBe(true);
    });
  });

  describe("goal reminders", () => {
    test("markGoalsReminded saves entries", () => {
      repo.markGoalsReminded([1, 2, 3]);
      const ids = repo.getRecentlyRemindedGoalIds(180);
      expect(ids).toEqual(expect.arrayContaining([1, 2, 3]));
      expect(ids.length).toBe(3);
    });

    test("getRecentlyRemindedGoalIds returns IDs within cooldown", () => {
      repo.markGoalsReminded([10, 20]);
      // Just marked — should be within any cooldown
      const ids = repo.getRecentlyRemindedGoalIds(1);
      expect(ids).toContain(10);
      expect(ids).toContain(20);
    });

    test("getRecentlyRemindedGoalIds excludes expired entries", () => {
      // Insert with a past timestamp (2 hours ago)
      db.prepare(
        "INSERT INTO goal_reminders (goal_id, reminded_at) VALUES (?, datetime('now', '-2 hours'))",
      ).run(99);

      // Cooldown of 60 min — 2 hours ago should be expired
      const ids = repo.getRecentlyRemindedGoalIds(60);
      expect(ids).not.toContain(99);

      // Cooldown of 180 min — 2 hours ago should still be within
      const ids2 = repo.getRecentlyRemindedGoalIds(180);
      expect(ids2).toContain(99);
    });

    test("markGoalsReminded upserts on conflict", () => {
      repo.markGoalsReminded([5]);
      repo.markGoalsReminded([5]); // second call should not throw
      const ids = repo.getRecentlyRemindedGoalIds(180);
      expect(ids.filter((id) => id === 5).length).toBe(1);
    });

    test("markGoalsReminded with empty array is no-op", () => {
      repo.markGoalsReminded([]);
      const ids = repo.getRecentlyRemindedGoalIds(180);
      expect(ids.length).toBe(0);
    });
  });
});
