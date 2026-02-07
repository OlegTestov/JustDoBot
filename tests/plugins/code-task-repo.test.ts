import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CodeTaskRepository } from "../../src/plugins/database/sqlite/code-tasks";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";
import type { ProjectRepository } from "../../src/plugins/database/sqlite/projects";

let db: SqliteMemoryProvider;
let projectRepo: ProjectRepository;
let codeTaskRepo: CodeTaskRepository;
let projectId: number;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
  projectRepo = db.getProjectRepo();
  codeTaskRepo = db.getCodeTaskRepo();
  projectId = projectRepo.createProject("test-proj", "user1");
});

afterEach(async () => {
  await db.destroy();
});

// ─── CodeTaskRepository ─────────────────────────────────────────────

describe("CodeTaskRepository", () => {
  test("logs task with all result fields", () => {
    const id = codeTaskRepo.logTask(projectId, "fix the login bug", {
      success: true,
      resultText: "Fixed authentication flow",
      durationMs: 12345,
      numTurns: 3,
      costUsd: 0.042,
      exitCode: 0,
    });

    expect(id).toBeGreaterThan(0);

    const history = codeTaskRepo.getTaskHistory(projectId);
    expect(history.length).toBe(1);

    const task = history[0];
    expect(task.id).toBe(id);
    expect(task.projectId).toBe(projectId);
    expect(task.prompt).toBe("fix the login bug");
    expect(task.resultText).toBe("Fixed authentication flow");
    expect(task.success).toBe(true);
    expect(task.durationMs).toBe(12345);
    expect(task.numTurns).toBe(3);
    expect(task.costUsd).toBe(0.042);
    expect(task.exitCode).toBe(0);
    expect(task.createdAt).toBeTruthy();
  });

  test("getTaskHistory returns in DESC order", () => {
    codeTaskRepo.logTask(projectId, "first task", {
      success: true,
      resultText: "Result 1",
      durationMs: 1000,
      numTurns: 1,
      costUsd: 0.01,
      exitCode: 0,
    });

    codeTaskRepo.logTask(projectId, "second task", {
      success: false,
      resultText: "Result 2",
      durationMs: 2000,
      numTurns: 2,
      costUsd: 0.02,
      exitCode: 1,
    });

    codeTaskRepo.logTask(projectId, "third task", {
      success: true,
      resultText: "Result 3",
      durationMs: 3000,
      numTurns: 3,
      costUsd: 0.03,
      exitCode: 0,
    });

    const history = codeTaskRepo.getTaskHistory(projectId);
    expect(history.length).toBe(3);
    // DESC order: newest first
    expect(history[0].prompt).toBe("third task");
    expect(history[1].prompt).toBe("second task");
    expect(history[2].prompt).toBe("first task");
  });

  test("getTaskHistory respects limit", () => {
    for (let i = 1; i <= 5; i++) {
      codeTaskRepo.logTask(projectId, `task ${i}`, {
        success: true,
        resultText: `Result ${i}`,
        durationMs: i * 1000,
        numTurns: i,
        costUsd: i * 0.01,
        exitCode: 0,
      });
    }

    const limited = codeTaskRepo.getTaskHistory(projectId, 2);
    expect(limited.length).toBe(2);
    // Should return the 2 most recent (DESC order)
    expect(limited[0].prompt).toBe("task 5");
    expect(limited[1].prompt).toBe("task 4");
  });
});
