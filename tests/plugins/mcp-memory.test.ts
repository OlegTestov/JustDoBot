import { describe, expect, test } from "bun:test";
import type { Goal, IMemoryProvider, Memory } from "../../src/core/interfaces";

/**
 * These tests verify the MCP tool logic by testing the database operations
 * that the MCP tools delegate to. We can't easily unit-test MCP tool handlers
 * directly (they require the SDK runtime), so we test the underlying logic
 * that save_memory, save_goal, and update_goal rely on.
 */

function createInMemoryDb(): IMemoryProvider & {
  _memories: Memory[];
  _goals: Goal[];
  _nextMemId: number;
  _nextGoalId: number;
} {
  const state = {
    _memories: [] as Memory[],
    _goals: [] as Goal[],
    _nextMemId: 1,
    _nextGoalId: 1,
  };

  return {
    ...state,
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

    async saveMemory(memory: Memory) {
      const id = state._nextMemId++;
      state._memories.push({ ...memory, id, active: memory.active ?? 1 });
      return id;
    },

    async getMemories(options: { active?: boolean; limit?: number }) {
      let result = [...state._memories];
      if (options.active !== false) {
        result = result.filter((m) => m.active === 1);
      }
      return result.slice(0, options.limit ?? 50);
    },

    async checkExactDuplicate(content: string) {
      return state._memories.find((m) => m.content === content && m.active === 1) ?? null;
    },

    async updateMemory(id: number, updates: Partial<Memory>) {
      const mem = state._memories.find((m) => m.id === id);
      if (mem) Object.assign(mem, updates);
    },

    async deleteMemory(id: number) {
      const mem = state._memories.find((m) => m.id === id);
      if (mem) mem.active = 0;
    },

    async saveGoal(goal: Omit<Goal, "id" | "created_at" | "updated_at">) {
      const id = state._nextGoalId++;
      state._goals.push({
        ...goal,
        id,
        progress_notes: goal.progress_notes ?? "[]",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return id;
    },

    async getActiveGoals() {
      return state._goals.filter((g) => g.status === "active");
    },

    async getGoal(id: number) {
      return state._goals.find((g) => g.id === id) ?? null;
    },

    async updateGoal(id: number, action: string, note?: string) {
      const goal = state._goals.find((g) => g.id === id);
      if (!goal) return;
      const notes = JSON.parse(goal.progress_notes || "[]");
      if (note) notes.push({ date: new Date().toISOString(), note });
      goal.progress_notes = JSON.stringify(notes);
      if (action === "complete") goal.status = "completed";
      else if (action === "pause") goal.status = "paused";
      else if (action === "cancel") goal.status = "cancelled";
      else if (action === "resume") goal.status = "active";
    },

    async searchGoalsByTitle(title: string) {
      const lower = title.toLowerCase();
      return state._goals.filter(
        (g) => g.status === "active" && g.title.toLowerCase().includes(lower),
      );
    },

    async editGoal(
      id: number,
      updates: { title?: string; description?: string; deadline?: string | null },
      note?: string,
    ) {
      const goal = state._goals.find((g) => g.id === id);
      if (!goal) return null;
      if (updates.title !== undefined) goal.title = updates.title;
      if (updates.description !== undefined) goal.description = updates.description;
      if (updates.deadline !== undefined) goal.deadline = updates.deadline ?? undefined;
      const notes = JSON.parse(goal.progress_notes || "[]");
      notes.push({
        date: new Date().toISOString(),
        note: note ?? `Edited: ${Object.keys(updates).join(", ")} updated`,
      });
      goal.progress_notes = JSON.stringify(notes);
      goal.updated_at = new Date().toISOString();
      return goal;
    },
  };
}

describe("MCP save_memory logic", () => {
  test("saves new memory", async () => {
    const db = createInMemoryDb();
    const id = await db.saveMemory!({
      category: "fact",
      content: "User likes coffee",
      confidence: 0.9,
    });

    expect(id).toBe(1);
    const memories = await db.getMemories!({ active: true, limit: 10 });
    expect(memories.length).toBe(1);
    expect(memories[0].content).toBe("User likes coffee");
  });

  test("dedup: detects exact duplicate", async () => {
    const db = createInMemoryDb();
    await db.saveMemory!({
      category: "fact",
      content: "User likes coffee",
      confidence: 0.8,
    });

    const dup = await db.checkExactDuplicate!("User likes coffee");
    expect(dup).not.toBeNull();
    expect(dup!.confidence).toBe(0.8);

    // Update confidence if higher
    if (dup && 0.95 > (dup.confidence ?? 0)) {
      await db.updateMemory!(dup.id!, { confidence: 0.95 });
    }

    const updated = await db.getMemories!({ active: true, limit: 10 });
    expect(updated[0].confidence).toBe(0.95);
  });

  test("dedup: no false positive for different content", async () => {
    const db = createInMemoryDb();
    await db.saveMemory!({
      category: "fact",
      content: "User likes coffee",
      confidence: 0.8,
    });

    const dup = await db.checkExactDuplicate!("User likes tea");
    expect(dup).toBeNull();
  });

  test("soft delete hides memory from active queries", async () => {
    const db = createInMemoryDb();
    const id = await db.saveMemory!({
      category: "fact",
      content: "Temporary fact",
      confidence: 0.5,
    });

    await db.deleteMemory!(id);

    const active = await db.getMemories!({ active: true, limit: 10 });
    expect(active.length).toBe(0);
  });
});

describe("MCP save_goal logic", () => {
  test("saves new goal", async () => {
    const db = createInMemoryDb();
    const id = await db.saveGoal!({
      title: "Learn Rust",
      status: "active",
      deadline: "2025-12-31",
    });

    expect(id).toBe(1);
    const goals = await db.getActiveGoals!();
    expect(goals.length).toBe(1);
    expect(goals[0].title).toBe("Learn Rust");
    expect(goals[0].deadline).toBe("2025-12-31");
  });

  test("saves goal without deadline", async () => {
    const db = createInMemoryDb();
    await db.saveGoal!({
      title: "Be happier",
      status: "active",
    });

    const goals = await db.getActiveGoals!();
    expect(goals[0].deadline).toBeUndefined();
  });
});

describe("MCP close_goal logic", () => {
  test("completes goal by ID", async () => {
    const db = createInMemoryDb();
    const id = await db.saveGoal!({
      title: "Test goal",
      status: "active",
    });

    await db.updateGoal!(id, "complete", "All done!");

    const goal = await db.getGoal!(id);
    expect(goal!.status).toBe("completed");
    const notes = JSON.parse(goal!.progress_notes!);
    expect(notes[0].note).toBe("All done!");
  });

  test("resolves goal by title search", async () => {
    const db = createInMemoryDb();
    await db.saveGoal!({
      title: "Learn TypeScript generics",
      status: "active",
    });

    const matches = await db.searchGoalsByTitle!("TypeScript");
    expect(matches.length).toBe(1);

    await db.updateGoal!(matches[0].id!, "complete");

    const goal = await db.getGoal!(matches[0].id!);
    expect(goal!.status).toBe("completed");
  });

  test("multiple matches returns all for disambiguation", async () => {
    const db = createInMemoryDb();
    await db.saveGoal!({
      title: "Learn TypeScript",
      status: "active",
    });
    await db.saveGoal!({
      title: "Master TypeScript",
      status: "active",
    });

    const matches = await db.searchGoalsByTitle!("TypeScript");
    expect(matches.length).toBe(2);
  });

  test("pause and resume cycle", async () => {
    const db = createInMemoryDb();
    const id = await db.saveGoal!({
      title: "Exercise",
      status: "active",
    });

    await db.updateGoal!(id, "pause", "Taking a break");
    let goal = await db.getGoal!(id);
    expect(goal!.status).toBe("paused");

    await db.updateGoal!(id, "resume", "Back at it");
    goal = await db.getGoal!(id);
    expect(goal!.status).toBe("active");

    const notes = JSON.parse(goal!.progress_notes!);
    expect(notes.length).toBe(2);
  });
});

describe("MCP edit_goal logic", () => {
  test("edits goal title via editGoal", async () => {
    const db = createInMemoryDb();
    const id = await db.saveGoal!({
      title: "3 improvements",
      status: "active",
      deadline: "2026-02-15",
    });

    const updated = await db.editGoal!(id, { title: "5 improvements" });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("5 improvements");
    expect(updated!.deadline).toBe("2026-02-15");
    expect(updated!.status).toBe("active");
  });

  test("edits goal deadline", async () => {
    const db = createInMemoryDb();
    const id = await db.saveGoal!({
      title: "My goal",
      status: "active",
      deadline: "2026-06-01",
    });

    const updated = await db.editGoal!(id, { deadline: "2026-07-01" });
    expect(updated!.deadline).toBe("2026-07-01");
  });

  test("returns null for non-existent goal", async () => {
    const db = createInMemoryDb();
    const result = await db.editGoal!(999, { title: "Nope" });
    expect(result).toBeNull();
  });

  test("appends edit note to progress_notes", async () => {
    const db = createInMemoryDb();
    const id = await db.saveGoal!({
      title: "Old title",
      status: "active",
    });

    await db.editGoal!(id, { title: "New title" }, "User corrected");
    const goal = await db.getGoal!(id);
    const notes = JSON.parse(goal!.progress_notes!);
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe("User corrected");
  });
});

describe("MCP edit_memory logic", () => {
  test("updates memory content", async () => {
    const db = createInMemoryDb();
    const id = await db.saveMemory!({
      category: "fact",
      content: "User is 25 years old",
      confidence: 0.9,
    });

    await db.updateMemory!(id, { content: "User is 26 years old" });
    const memories = await db.getMemories!({ active: true, limit: 10 });
    expect(memories[0].content).toBe("User is 26 years old");
  });

  test("updates memory category", async () => {
    const db = createInMemoryDb();
    const id = await db.saveMemory!({
      category: "fact",
      content: "Some info",
      confidence: 0.8,
    });

    await db.updateMemory!(id, { category: "insight" });
    const memories = await db.getMemories!({ active: true, limit: 10 });
    expect(memories[0].category).toBe("insight");
  });
});

describe("MCP delete_memory logic", () => {
  test("soft-deletes memory", async () => {
    const db = createInMemoryDb();
    const id = await db.saveMemory!({
      category: "fact",
      content: "Wrong fact",
      confidence: 0.5,
    });

    await db.deleteMemory!(id);
    const active = await db.getMemories!({ active: true, limit: 10 });
    expect(active.length).toBe(0);
  });

  test("deleted memory still exists with active=false", async () => {
    const db = createInMemoryDb();
    const id = await db.saveMemory!({
      category: "fact",
      content: "Obsolete fact",
      confidence: 0.7,
    });

    await db.deleteMemory!(id);
    const all = await db.getMemories!({ active: false, limit: 10 });
    expect(all.length).toBe(1);
    expect(all[0].active).toBe(0);
  });
});
