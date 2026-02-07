import type { Database } from "bun:sqlite";
import type { CheckInLog } from "../../../core/interfaces";

export class CheckInRepository {
  constructor(private db: Database) {}

  saveLog(log: Omit<CheckInLog, "id" | "created_at">): number {
    const stmt = this.db.prepare(`
      INSERT INTO check_in_logs (user_id, data_hash, sources, gating_result, skip_reason, urgency, message_sent, tokens_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      log.user_id ?? null,
      log.data_hash,
      JSON.stringify(log.sources),
      log.gating_result ?? null,
      log.skip_reason ?? null,
      log.urgency ?? null,
      log.message_sent ?? null,
      log.tokens_used ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  getRecentLogs(limit: number): CheckInLog[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, data_hash, sources, gating_result, skip_reason, urgency, message_sent, tokens_used, created_at
      FROM check_in_logs
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{
      id: number;
      user_id: string | null;
      data_hash: string;
      sources: string;
      gating_result: string | null;
      skip_reason: string | null;
      urgency: number | null;
      message_sent: string | null;
      tokens_used: number | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id ?? undefined,
      data_hash: r.data_hash,
      sources: JSON.parse(r.sources),
      gating_result: r.gating_result as "text" | "call" | "skip" | undefined,
      skip_reason: r.skip_reason ?? undefined,
      urgency: r.urgency ?? undefined,
      message_sent: r.message_sent ?? undefined,
      tokens_used: r.tokens_used ?? undefined,
      created_at: r.created_at,
    }));
  }

  getLastSentTime(): string | null {
    const stmt = this.db.prepare(`
      SELECT created_at FROM check_in_logs
      WHERE gating_result IN ('text', 'call')
      ORDER BY id DESC LIMIT 1
    `);
    const row = stmt.get() as { created_at: string } | undefined;
    return row?.created_at ?? null;
  }

  // ─── Goal Reminders ─────────────────────────────────────────

  getRecentlyRemindedGoalIds(cooldownMinutes: number): number[] {
    const stmt = this.db.prepare(`
      SELECT goal_id FROM goal_reminders
      WHERE datetime(reminded_at, '+' || ? || ' minutes') > datetime('now')
    `);
    const rows = stmt.all(cooldownMinutes) as Array<{ goal_id: number }>;
    return rows.map((r) => r.goal_id);
  }

  markGoalsReminded(goalIds: number[]): void {
    if (goalIds.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT INTO goal_reminders (goal_id, reminded_at) VALUES (?, datetime('now'))
      ON CONFLICT(goal_id) DO UPDATE SET reminded_at = datetime('now')
    `);
    for (const id of goalIds) {
      stmt.run(id);
    }
  }

  // ─── Quiet Mode ──────────────────────────────────────────────

  setQuietMode(userId: string, untilISO: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO quiet_mode (user_id, until) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, set_at = datetime('now')
    `);
    stmt.run(userId, untilISO);
  }

  clearQuietMode(userId: string): void {
    const stmt = this.db.prepare("DELETE FROM quiet_mode WHERE user_id = ?");
    stmt.run(userId);
  }

  isQuietMode(userId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT until FROM quiet_mode WHERE user_id = ? AND datetime(until) > datetime('now')
    `);
    const row = stmt.get(userId) as { until: string } | undefined;
    return !!row;
  }
}
