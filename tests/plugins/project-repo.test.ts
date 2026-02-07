import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TaskResult } from "../../src/core/interfaces";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";
import type { ProjectRepository } from "../../src/plugins/database/sqlite/projects";

let db: SqliteMemoryProvider;
let repo: ProjectRepository;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
  repo = db.getProjectRepo();
});

afterEach(async () => {
  await db.destroy();
});

// ─── ProjectRepository ──────────────────────────────────────────────

describe("ProjectRepository", () => {
  test("creates project with correct fields", () => {
    const id = repo.createProject("my-project", "user-1");
    expect(id).toBeGreaterThan(0);

    const project = repo.getProject("my-project");
    expect(project).not.toBeNull();
    expect(project!.name).toBe("my-project");
    expect(project!.status).toBe("active");
    expect(project!.userId).toBe("user-1");
    expect(project!.totalCostUsd).toBe(0);
    expect(project!.createdAt).toBeDefined();
    expect(project!.updatedAt).toBeDefined();
  });

  test("updateStatus changes status and updated_at", () => {
    repo.createProject("status-project", "user-1");
    const before = repo.getProject("status-project")!;
    const beforeUpdated = before.updatedAt;

    repo.updateStatus("status-project", "running");

    const after = repo.getProject("status-project")!;
    expect(after.status).toBe("running");
    // updated_at should be >= the original value (datetime precision may match)
    expect(after.updatedAt! >= beforeUpdated!).toBe(true);
  });

  test("updateTaskResult saves all fields and accumulates total_cost_usd", () => {
    repo.createProject("task-project", "user-1");

    const result1: TaskResult = {
      success: true,
      resultText: "First run done",
      durationMs: 5000,
      numTurns: 3,
      costUsd: 0.25,
      exitCode: 0,
    };
    repo.updateTaskResult("task-project", result1, "Build the feature");

    const p1 = repo.getProject("task-project")!;
    expect(p1.lastTaskPrompt).toBe("Build the feature");
    expect(p1.lastTaskResult).toBe("First run done");
    expect(p1.lastTaskDurationMs).toBe(5000);
    expect(p1.lastTaskTurns).toBe(3);
    expect(p1.lastTaskCostUsd).toBe(0.25);
    expect(p1.totalCostUsd).toBe(0.25);

    // Second task — total_cost_usd should accumulate
    const result2: TaskResult = {
      success: false,
      resultText: "Second run failed",
      durationMs: 3000,
      numTurns: 2,
      costUsd: 0.1,
      exitCode: 1,
    };
    repo.updateTaskResult("task-project", result2, "Fix the bug");

    const p2 = repo.getProject("task-project")!;
    expect(p2.lastTaskPrompt).toBe("Fix the bug");
    expect(p2.lastTaskResult).toBe("Second run failed");
    expect(p2.lastTaskDurationMs).toBe(3000);
    expect(p2.lastTaskTurns).toBe(2);
    expect(p2.lastTaskCostUsd).toBe(0.1);
    expect(p2.totalCostUsd).toBeCloseTo(0.35, 10);
  });

  test("getProject returns null for non-existent", () => {
    const project = repo.getProject("does-not-exist");
    expect(project).toBeNull();
  });

  test("listProjects filters by userId", () => {
    repo.createProject("proj-a", "alice");
    repo.createProject("proj-b", "bob");
    repo.createProject("proj-c", "alice");

    const aliceProjects = repo.listProjects("alice");
    expect(aliceProjects.length).toBe(2);
    expect(aliceProjects.every((p) => p.userId === "alice")).toBe(true);

    const bobProjects = repo.listProjects("bob");
    expect(bobProjects.length).toBe(1);
    expect(bobProjects[0].name).toBe("proj-b");

    // Without userId filter — returns all
    const allProjects = repo.listProjects();
    expect(allProjects.length).toBe(3);
  });

  test("listProjects excludes deleted projects", () => {
    repo.createProject("alive", "user-1");
    repo.createProject("to-delete", "user-1");
    repo.markDeleted("to-delete");

    const projects = repo.listProjects();
    expect(projects.length).toBe(1);
    expect(projects[0].name).toBe("alive");
  });

  test("markDeleted sets status to deleted", () => {
    repo.createProject("doomed", "user-1");
    repo.markDeleted("doomed");

    // getProject excludes deleted, so it should return null
    const project = repo.getProject("doomed");
    expect(project).toBeNull();
  });

  test("getActiveProjectCount returns correct count", () => {
    repo.createProject("p1", "alice");
    repo.createProject("p2", "alice");
    repo.createProject("p3", "bob");
    repo.updateStatus("p1", "running");
    repo.updateStatus("p2", "completed");
    repo.markDeleted("p3");

    // alice has 2 active-ish projects (running + completed)
    expect(repo.getActiveProjectCount("alice")).toBe(2);
    // bob's project is deleted, so count is 0
    expect(repo.getActiveProjectCount("bob")).toBe(0);
    // Overall: 2 non-deleted
    expect(repo.getActiveProjectCount()).toBe(2);
  });

  test("unique constraint on project name", () => {
    repo.createProject("unique-name", "user-1");
    expect(() => repo.createProject("unique-name", "user-2")).toThrow();
  });

  test("resetStuckProjects sets running to error", () => {
    repo.createProject("runner-1", "user-1");
    repo.createProject("runner-2", "user-1");
    repo.createProject("completed-1", "user-1");

    repo.updateStatus("runner-1", "running");
    repo.updateStatus("runner-2", "running");
    repo.updateStatus("completed-1", "completed");

    const changed = repo.resetStuckProjects();
    expect(changed).toBe(2);

    expect(repo.getProject("runner-1")!.status).toBe("error");
    expect(repo.getProject("runner-2")!.status).toBe("error");
    expect(repo.getProject("completed-1")!.status).toBe("completed");
  });

  test("getTotalCost returns sum across all projects", () => {
    repo.createProject("cost-a", "user-1");
    repo.createProject("cost-b", "user-1");

    const taskA: TaskResult = {
      success: true,
      resultText: "Done A",
      durationMs: 1000,
      numTurns: 1,
      costUsd: 1.5,
      exitCode: 0,
    };
    const taskB: TaskResult = {
      success: true,
      resultText: "Done B",
      durationMs: 2000,
      numTurns: 2,
      costUsd: 2.5,
      exitCode: 0,
    };

    repo.updateTaskResult("cost-a", taskA, "prompt a");
    repo.updateTaskResult("cost-b", taskB, "prompt b");

    expect(repo.getTotalCost()).toBeCloseTo(4.0, 10);
  });
});
