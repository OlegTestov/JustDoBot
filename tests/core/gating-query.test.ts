import { describe, expect, test } from "bun:test";
import { GatingResultSchema, runGatingQuery } from "../../src/core/gating-query";
import type { IAIEngine } from "../../src/core/interfaces";

function createMockEngine(response: unknown): IAIEngine {
  return {
    name: "mock",
    version: "1.0.0",
    async init() {},
    async *queryStream() {},
    abort() {},
    async destroy() {},
    async healthCheck() {
      return { healthy: true, lastCheck: new Date() };
    },
    async queryStructured<T>(): Promise<T> {
      return response as T;
    },
  };
}

describe("GatingResultSchema", () => {
  test("validates text result", () => {
    const result = GatingResultSchema.parse({
      action: "text",
      urgency: 7,
      message: "You have a meeting in 30 minutes!",
    });
    expect(result.action).toBe("text");
    expect(result.urgency).toBe(7);
    expect(result.message).toBe("You have a meeting in 30 minutes!");
  });

  test("validates skip result", () => {
    const result = GatingResultSchema.parse({
      action: "skip",
      urgency: 2,
      reason: "No important events",
    });
    expect(result.action).toBe("skip");
    expect(result.urgency).toBe(2);
    expect(result.reason).toBe("No important events");
  });

  test("rejects invalid action", () => {
    expect(() => GatingResultSchema.parse({ action: "unknown", urgency: 5 })).toThrow();
  });

  test("rejects urgency out of range", () => {
    expect(() => GatingResultSchema.parse({ action: "skip", urgency: 0 })).toThrow();
    expect(() => GatingResultSchema.parse({ action: "skip", urgency: 11 })).toThrow();
  });
});

describe("runGatingQuery", () => {
  test("returns text result from AI engine", async () => {
    const engine = createMockEngine({
      action: "text",
      urgency: 8,
      message: "Meeting soon!",
    });

    const result = await runGatingQuery(
      engine,
      { calendar: [{ title: "Meeting", start: "2025-06-15T10:00:00" }] },
      [],
      "en",
    );

    expect(result.action).toBe("text");
    expect(result.urgency).toBe(8);
    expect(result.message).toBe("Meeting soon!");
  });

  test("returns skip result from AI engine", async () => {
    const engine = createMockEngine({
      action: "skip",
      urgency: 1,
      reason: "Nothing noteworthy",
    });

    const result = await runGatingQuery(engine, { goals: [] }, [], "en");
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("Nothing noteworthy");
  });

  test("falls back to skip on AI error", async () => {
    const engine = createMockEngine(null);
    // Override queryStructured to throw
    engine.queryStructured = async () => {
      throw new Error("API error");
    };

    const result = await runGatingQuery(engine, {}, [], "en");
    expect(result.action).toBe("skip");
    expect(result.urgency).toBe(1);
    expect(result.reason).toContain("Gating query error");
  });

  test("falls back to skip when queryStructured is missing", async () => {
    const engine = createMockEngine(null);
    engine.queryStructured = undefined;

    const result = await runGatingQuery(engine, {}, [], "en");
    expect(result.action).toBe("skip");
    expect(result.reason).toContain("does not support structured queries");
  });
});
