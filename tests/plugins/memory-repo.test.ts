import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";

let db: SqliteMemoryProvider;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
});

afterEach(async () => {
  await db.destroy();
});

// ─── MemoryRepository ──────────────────────────────────────────────

describe("MemoryRepository", () => {
  test("saveMemory returns ID", async () => {
    const id = await db.saveMemory!({
      category: "fact",
      content: "User likes TypeScript",
      confidence: 0.9,
    });
    expect(id).toBeGreaterThan(0);
  });

  test("getMemories returns active memories", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "Fact 1",
      confidence: 0.8,
    });
    await db.saveMemory!({
      category: "preference",
      content: "Preference 1",
      confidence: 0.7,
    });

    const memories = await db.getMemories!({ active: true, limit: 10 });
    expect(memories.length).toBe(2);
    // Ordered by id DESC
    expect(memories[0].content).toBe("Preference 1");
    expect(memories[1].content).toBe("Fact 1");
  });

  test("deleteMemory soft-deletes (sets active=0)", async () => {
    const id = await db.saveMemory!({
      category: "fact",
      content: "To be deleted",
      confidence: 0.5,
    });

    await db.deleteMemory!(id);

    const active = await db.getMemories!({ active: true, limit: 10 });
    expect(active.length).toBe(0);

    // Still in DB with active=false query
    const all = await db.getMemories!({ active: false, limit: 10 });
    expect(all.length).toBe(1);
    expect(all[0].active).toBe(0);
  });

  test("updateMemory changes fields", async () => {
    const id = await db.saveMemory!({
      category: "fact",
      content: "Original",
      confidence: 0.5,
    });

    await db.updateMemory!(id, { confidence: 0.95, category: "insight" });

    const memories = await db.getMemories!({ active: true, limit: 10 });
    expect(memories[0].confidence).toBe(0.95);
    expect(memories[0].category).toBe("insight");
  });

  test("checkExactDuplicate finds existing memory", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "Exact content",
      confidence: 0.8,
    });

    const dup = await db.checkExactDuplicate!("Exact content");
    expect(dup).not.toBeNull();
    expect(dup!.content).toBe("Exact content");

    const noDup = await db.checkExactDuplicate!("Different content");
    expect(noDup).toBeNull();
  });

  test("searchMemoriesFTS finds by keyword", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "User loves TypeScript programming",
      confidence: 0.9,
    });
    await db.saveMemory!({
      category: "preference",
      content: "Prefers morning coffee",
      confidence: 0.8,
    });

    const repo = db.getMemoryRepo();
    const results = repo.searchMemoriesFTS("TypeScript", 10);
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("TypeScript");
  });

  test("searchMemoriesFTS handles empty query", async () => {
    const repo = db.getMemoryRepo();
    const results = repo.searchMemoriesFTS("", 10);
    expect(results.length).toBe(0);
  });

  test("searchMemoriesFTS handles special characters", async () => {
    await db.saveMemory!({
      category: "fact",
      content: "User's favorite is O'Reilly books",
      confidence: 0.7,
    });

    const repo = db.getMemoryRepo();
    // Should not throw on special chars
    const results = repo.searchMemoriesFTS("O'Reilly", 10);
    // Escaping may change results but should not throw
    expect(Array.isArray(results)).toBe(true);
  });
});

// ─── GoalRepository ────────────────────────────────────────────────

describe("GoalRepository", () => {
  test("saveGoal returns ID", async () => {
    const id = await db.saveGoal!({
      title: "Learn Rust",
      status: "active",
    });
    expect(id).toBeGreaterThan(0);
  });

  test("getActiveGoals returns only active goals", async () => {
    await db.saveGoal!({
      title: "Active goal",
      status: "active",
    });
    await db.saveGoal!({
      title: "Completed goal",
      status: "completed",
    });

    const active = await db.getActiveGoals!();
    expect(active.length).toBe(1);
    expect(active[0].title).toBe("Active goal");
  });

  test("getActiveGoals orders by deadline ASC, nulls last", async () => {
    await db.saveGoal!({
      title: "No deadline",
      status: "active",
    });
    await db.saveGoal!({
      title: "Far deadline",
      status: "active",
      deadline: "2030-12-31",
    });
    await db.saveGoal!({
      title: "Near deadline",
      status: "active",
      deadline: "2025-01-01",
    });

    const goals = await db.getActiveGoals!();
    expect(goals.length).toBe(3);
    expect(goals[0].title).toBe("Near deadline");
    expect(goals[1].title).toBe("Far deadline");
    expect(goals[2].title).toBe("No deadline");
  });

  test("updateGoal changes status and appends progress note", async () => {
    const id = await db.saveGoal!({
      title: "Test goal",
      status: "active",
    });

    await db.updateGoal!(id, "complete", "All done!");

    const goal = await db.getGoal!(id);
    expect(goal).not.toBeNull();
    expect(goal!.status).toBe("completed");

    const notes = JSON.parse(goal!.progress_notes || "[]");
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe("All done!");
  });

  test("updateGoal with pause action", async () => {
    const id = await db.saveGoal!({
      title: "Pausable goal",
      status: "active",
    });

    await db.updateGoal!(id, "pause", "Taking a break");

    const goal = await db.getGoal!(id);
    expect(goal!.status).toBe("paused");
  });

  test("searchGoalsByTitle finds matching goals", async () => {
    await db.saveGoal!({
      title: "Learn TypeScript generics",
      description: "Master advanced TS",
      status: "active",
    });
    await db.saveGoal!({
      title: "Exercise daily",
      status: "active",
    });

    const results = await db.searchGoalsByTitle!("TypeScript");
    expect(results.length).toBe(1);
    expect(results[0].title).toContain("TypeScript");
  });

  test("editGoal updates title and preserves other fields", async () => {
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

  test("editGoal updates deadline", async () => {
    const id = await db.saveGoal!({
      title: "My goal",
      status: "active",
      deadline: "2026-06-01",
    });

    const updated = await db.editGoal!(id, { deadline: "2026-07-01" });
    expect(updated!.deadline).toBe("2026-07-01");
  });

  test("editGoal removes deadline with null", async () => {
    const id = await db.saveGoal!({
      title: "My goal",
      status: "active",
      deadline: "2026-06-01",
    });

    const updated = await db.editGoal!(id, { deadline: null });
    expect(updated!.deadline).toBeNull();
  });

  test("editGoal appends progress note", async () => {
    const id = await db.saveGoal!({
      title: "Old title",
      status: "active",
    });

    await db.editGoal!(id, { title: "New title" }, "User corrected the title");

    const goal = await db.getGoal!(id);
    const notes = JSON.parse(goal!.progress_notes || "[]");
    expect(notes.length).toBe(1);
    expect(notes[0].note).toBe("User corrected the title");
  });

  test("editGoal returns null for non-existent ID", async () => {
    const result = await db.editGoal!(999, { title: "Nope" });
    expect(result).toBeNull();
  });

  test("editGoal updates FTS index", async () => {
    await db.saveGoal!({
      title: "Learn Python",
      status: "active",
    });

    const id = (await db.getActiveGoals!())[0].id!;
    await db.editGoal!(id, { title: "Learn Rust" });

    // Should NOT find by old title
    const oldResults = await db.searchGoalsByTitle!("Python");
    expect(oldResults.length).toBe(0);

    // Should find by new title
    const newResults = await db.searchGoalsByTitle!("Rust");
    expect(newResults.length).toBe(1);
  });

  test("progress_notes JSON accumulates", async () => {
    const id = await db.saveGoal!({
      title: "Multi-step goal",
      status: "active",
    });

    await db.updateGoal!(id, "resume", "Step 1 done");
    await db.updateGoal!(id, "resume", "Step 2 done");
    await db.updateGoal!(id, "complete", "All steps done");

    const goal = await db.getGoal!(id);
    const notes = JSON.parse(goal!.progress_notes || "[]");
    expect(notes.length).toBe(3);
    expect(notes[0].note).toBe("Step 1 done");
    expect(notes[2].note).toBe("All steps done");
  });
});
