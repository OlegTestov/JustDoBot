import type { Database } from "bun:sqlite";
import type { Goal } from "../../../core/interfaces";

export class GoalRepository {
  private stmtInsert;
  private stmtGetActive;
  private stmtGetById;
  private stmtSearchFTS;

  constructor(private db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO goals (title, description, status, deadline, progress_notes)
      VALUES ($title, $description, $status, $deadline, $progress_notes)
    `);

    this.stmtGetActive = db.prepare(`
      SELECT * FROM goals
      WHERE status = 'active'
      ORDER BY
        CASE WHEN deadline IS NOT NULL THEN 0 ELSE 1 END,
        deadline ASC,
        id DESC
    `);

    this.stmtGetById = db.prepare(`
      SELECT * FROM goals WHERE id = $id
    `);

    this.stmtSearchFTS = db.prepare(`
      SELECT g.*, rank
      FROM fts_goals f
      JOIN goals g ON g.id = f.rowid
      WHERE fts_goals MATCH $query AND g.status = 'active'
      ORDER BY rank
      LIMIT $limit
    `);
  }

  saveGoal(goal: Omit<Goal, "id" | "created_at" | "updated_at">): number {
    this.stmtInsert.run({
      $title: goal.title,
      $description: goal.description ?? null,
      $status: goal.status ?? "active",
      $deadline: goal.deadline ?? null,
      $progress_notes: goal.progress_notes ?? "[]",
    });
    return (this.db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  }

  getActiveGoals(): Goal[] {
    return this.stmtGetActive.all() as Goal[];
  }

  getGoalById(id: number): Goal | null {
    return (this.stmtGetById.get({ $id: id }) as Goal) ?? null;
  }

  updateGoal(id: number, action: string, note?: string): void {
    const goal = this.getGoalById(id);
    if (!goal) return;

    // Append progress note
    const notes = JSON.parse(goal.progress_notes || "[]") as Array<{
      date: string;
      note: string;
    }>;
    if (note) {
      notes.push({ date: new Date().toISOString(), note });
    }

    // Determine new status
    let newStatus = goal.status;
    if (action === "complete") newStatus = "completed";
    else if (action === "pause") newStatus = "paused";
    else if (action === "cancel") newStatus = "cancelled";
    else if (action === "resume") newStatus = "active";

    this.db
      .prepare(
        `UPDATE goals SET status = $status, progress_notes = $progress_notes, updated_at = datetime('now') WHERE id = $id`,
      )
      .run({
        $id: id,
        $status: newStatus,
        $progress_notes: JSON.stringify(notes),
      });
  }

  editGoal(
    id: number,
    updates: { title?: string; description?: string; deadline?: string | null },
    note?: string,
  ): Goal | null {
    const goal = this.getGoalById(id);
    if (!goal) return null;

    const sets: string[] = [];
    const params: Record<string, string | number | null> = { $id: id };

    if (updates.title !== undefined) {
      sets.push("title = $title");
      params.$title = updates.title;
    }
    if (updates.description !== undefined) {
      sets.push("description = $description");
      params.$description = updates.description;
    }
    if (updates.deadline !== undefined) {
      sets.push("deadline = $deadline");
      params.$deadline = updates.deadline;
    }

    // Append edit note to progress_notes
    const notes = JSON.parse(goal.progress_notes || "[]") as Array<{
      date: string;
      note: string;
    }>;
    const editNote = note ?? `Edited: ${Object.keys(updates).join(", ")} updated`;
    notes.push({ date: new Date().toISOString(), note: editNote });
    sets.push("progress_notes = $progress_notes");
    params.$progress_notes = JSON.stringify(notes);

    sets.push("updated_at = datetime('now')");

    this.db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE id = $id`).run(params);

    return this.getGoalById(id);
  }

  searchGoalsByTitleFTS(query: string): Goal[] {
    const safeQuery = query.replace(/['"*():]/g, " ").trim();
    if (!safeQuery) return [];
    try {
      return this.stmtSearchFTS.all({
        $query: safeQuery,
        $limit: 10,
      }) as Goal[];
    } catch {
      return [];
    }
  }
}
