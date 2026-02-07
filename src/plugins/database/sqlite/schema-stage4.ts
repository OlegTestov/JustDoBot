export const STAGE4_DDL_CORE = `
CREATE TABLE IF NOT EXISTS check_in_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  data_hash TEXT NOT NULL,
  sources TEXT NOT NULL,
  gating_result TEXT NOT NULL CHECK(gating_result IN ('text', 'call', 'skip')),
  skip_reason TEXT,
  urgency INTEGER,
  message_sent TEXT,
  tokens_used INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_check_in_created ON check_in_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_in_user ON check_in_logs(user_id);

CREATE TABLE IF NOT EXISTS quiet_mode (
  user_id TEXT PRIMARY KEY,
  until TEXT NOT NULL,
  set_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goal_reminders (
  goal_id INTEGER PRIMARY KEY,
  reminded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Migration: add 'call' to check_in_logs.gating_result CHECK constraint.
 * SQLite doesn't support ALTER CONSTRAINT, so we recreate the table.
 * Safe to run multiple times — checks if migration is needed first.
 */
export function migrateCheckInLogsAddCall(db: {
  exec: (sql: string) => void;
  query: (sql: string) => { get: () => unknown };
}): void {
  // Check if the existing constraint already allows 'call'
  // by reading the table DDL from sqlite_master
  const row = db
    .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='check_in_logs'")
    .get() as { sql: string } | null;

  if (!row) return; // table doesn't exist yet — STAGE4_DDL_CORE will create it
  if (row.sql.includes("'call'")) return; // already migrated

  db.exec(`
    CREATE TABLE check_in_logs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      data_hash TEXT NOT NULL,
      sources TEXT NOT NULL,
      gating_result TEXT NOT NULL CHECK(gating_result IN ('text', 'call', 'skip')),
      skip_reason TEXT,
      urgency INTEGER,
      message_sent TEXT,
      tokens_used INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO check_in_logs_new (id, user_id, data_hash, sources, gating_result, skip_reason, urgency, message_sent, tokens_used, created_at)
    SELECT id, user_id, data_hash, sources, gating_result, skip_reason, urgency, message_sent, tokens_used, created_at
    FROM check_in_logs;

    DROP TABLE check_in_logs;
    ALTER TABLE check_in_logs_new RENAME TO check_in_logs;

    CREATE INDEX IF NOT EXISTS idx_check_in_created ON check_in_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_check_in_user ON check_in_logs(user_id);
  `);
}
