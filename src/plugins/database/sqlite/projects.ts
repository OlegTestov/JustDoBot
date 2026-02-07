import type { Database } from "bun:sqlite";
import type { CodeProject, TaskResult } from "../../../core/interfaces";

export class ProjectRepository {
  private stmtInsert;
  private stmtGetByName;
  private stmtUpdateStatus;
  private stmtMarkDeleted;

  constructor(private db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO projects (name, user_id)
      VALUES ($name, $userId)
    `);

    this.stmtGetByName = db.prepare(`
      SELECT * FROM projects WHERE name = $name AND status != 'deleted'
    `);

    this.stmtUpdateStatus = db.prepare(`
      UPDATE projects SET status = $status, updated_at = datetime('now')
      WHERE name = $name
    `);

    this.stmtMarkDeleted = db.prepare(`
      UPDATE projects SET status = 'deleted', updated_at = datetime('now')
      WHERE name = $name
    `);
  }

  createProject(name: string, userId: string): number {
    this.stmtInsert.run({ $name: name, $userId: userId });
    return (this.db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  }

  updateStatus(name: string, status: CodeProject["status"]): void {
    this.stmtUpdateStatus.run({ $name: name, $status: status });
  }

  updateTaskResult(name: string, result: TaskResult, prompt: string): void {
    this.db
      .prepare(
        `UPDATE projects SET
          last_task_prompt = $prompt,
          last_task_result = $result,
          last_task_duration_ms = $duration,
          last_task_turns = $turns,
          last_task_cost_usd = $cost,
          total_cost_usd = COALESCE(total_cost_usd, 0) + COALESCE($cost, 0),
          updated_at = datetime('now')
        WHERE name = $name`,
      )
      .run({
        $name: name,
        $prompt: prompt,
        $result: result.resultText.slice(0, 10000),
        $duration: result.durationMs,
        $turns: result.numTurns,
        $cost: result.costUsd,
      });
  }

  getProject(name: string): CodeProject | null {
    const row = this.stmtGetByName.get({ $name: name }) as DbProjectRow | undefined;
    return row ? mapRow(row) : null;
  }

  listProjects(userId?: string): CodeProject[] {
    const sql = userId
      ? `SELECT * FROM projects WHERE status != 'deleted' AND user_id = $userId ORDER BY updated_at DESC`
      : `SELECT * FROM projects WHERE status != 'deleted' ORDER BY updated_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = (userId ? stmt.all({ $userId: userId }) : stmt.all()) as DbProjectRow[];
    return rows.map(mapRow);
  }

  markDeleted(name: string): void {
    this.stmtMarkDeleted.run({ $name: name });
  }

  getActiveProjectCount(userId?: string): number {
    const sql = userId
      ? `SELECT COUNT(*) as cnt FROM projects WHERE status IN ('active', 'running', 'completed', 'error') AND user_id = $userId`
      : `SELECT COUNT(*) as cnt FROM projects WHERE status IN ('active', 'running', 'completed', 'error')`;
    const stmt = this.db.prepare(sql);
    const row = (userId ? stmt.get({ $userId: userId }) : stmt.get()) as { cnt: number };
    return row.cnt;
  }

  resetStuckProjects(): number {
    const result = this.db
      .prepare(
        `UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE status = 'running'`,
      )
      .run();
    return result.changes;
  }

  getTotalCost(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(total_cost_usd), 0) as total FROM projects`)
      .get() as { total: number };
    return row.total;
  }
}

interface DbProjectRow {
  id: number;
  name: string;
  status: string;
  user_id: string;
  last_task_prompt: string | null;
  last_task_result: string | null;
  last_task_duration_ms: number | null;
  last_task_turns: number | null;
  last_task_cost_usd: number | null;
  total_cost_usd: number | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: DbProjectRow): CodeProject {
  return {
    id: r.id,
    name: r.name,
    status: r.status as CodeProject["status"],
    userId: r.user_id,
    lastTaskPrompt: r.last_task_prompt ?? undefined,
    lastTaskResult: r.last_task_result ?? undefined,
    lastTaskDurationMs: r.last_task_duration_ms ?? undefined,
    lastTaskTurns: r.last_task_turns ?? undefined,
    lastTaskCostUsd: r.last_task_cost_usd ?? undefined,
    totalCostUsd: r.total_cost_usd ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
