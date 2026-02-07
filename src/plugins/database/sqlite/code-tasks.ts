import type { Database } from "bun:sqlite";
import type { TaskResult } from "../../../core/interfaces";

export class CodeTaskRepository {
  private stmtInsert;
  private stmtGetHistory;

  constructor(private db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO code_tasks (project_id, prompt, result_text, success, duration_ms, num_turns, cost_usd, exit_code)
      VALUES ($projectId, $prompt, $resultText, $success, $durationMs, $numTurns, $costUsd, $exitCode)
    `);

    this.stmtGetHistory = db.prepare(`
      SELECT * FROM code_tasks
      WHERE project_id = $projectId
      ORDER BY id DESC
      LIMIT $limit
    `);
  }

  logTask(projectId: number, prompt: string, result: TaskResult): number {
    this.stmtInsert.run({
      $projectId: projectId,
      $prompt: prompt,
      $resultText: result.resultText.slice(0, 10000),
      $success: result.success ? 1 : 0,
      $durationMs: result.durationMs,
      $numTurns: result.numTurns,
      $costUsd: result.costUsd,
      $exitCode: result.exitCode,
    });
    return (this.db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  }

  getTaskHistory(
    projectId: number,
    limit = 20,
  ): Array<{
    id: number;
    projectId: number;
    prompt: string;
    resultText: string | null;
    success: boolean;
    durationMs: number;
    numTurns: number;
    costUsd: number;
    exitCode: number;
    createdAt: string;
  }> {
    const rows = this.stmtGetHistory.all({ $projectId: projectId, $limit: limit }) as Array<{
      id: number;
      project_id: number;
      prompt: string;
      result_text: string | null;
      success: number;
      duration_ms: number;
      num_turns: number;
      cost_usd: number;
      exit_code: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      prompt: r.prompt,
      resultText: r.result_text,
      success: r.success === 1,
      durationMs: r.duration_ms,
      numTurns: r.num_turns,
      costUsd: r.cost_usd,
      exitCode: r.exit_code,
      createdAt: r.created_at,
    }));
  }
}
