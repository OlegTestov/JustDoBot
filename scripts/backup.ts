/**
 * Extended backup script — exports data as JSON + SQLite backup.
 *
 * Usage: bun run backup
 */

import { Database } from "bun:sqlite";
import { mkdir, unlink } from "node:fs/promises";

const DB_PATH = process.env.DB_PATH ?? "./data/bot.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const date = new Date().toISOString().split("T")[0];

  await mkdir(BACKUP_DIR, { recursive: true });

  // ─── JSON Export ─────────────────────────────────────────────
  const memories = db.prepare("SELECT * FROM memories WHERE active = 1").all();
  const goals = db.prepare("SELECT * FROM goals").all();
  const messageCount = (db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number })
    .cnt;

  let vaultDocCount = 0;
  try {
    vaultDocCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM vault_documents").get() as { cnt: number }
    ).cnt;
  } catch {
    /* table may not exist */
  }

  let checkInCount = 0;
  try {
    checkInCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM check_in_logs").get() as { cnt: number }
    ).cnt;
  } catch {
    /* table may not exist */
  }

  const jsonData = {
    exported_at: new Date().toISOString(),
    stats: {
      total_messages: messageCount,
      vault_documents: vaultDocCount,
      check_ins: checkInCount,
    },
    memories,
    goals,
  };

  const jsonPath = `${BACKUP_DIR}/backup-${date}.json`;
  await Bun.write(jsonPath, JSON.stringify(jsonData, null, 2));
  console.log(`JSON backup: ${jsonPath} (${memories.length} memories, ${goals.length} goals)`);

  // ─── SQLite Backup ───────────────────────────────────────────
  const dbPath = `${BACKUP_DIR}/bot-${date}.db`;
  await unlink(dbPath).catch(() => {});
  db.exec(`VACUUM INTO '${dbPath}'`);
  console.log(`SQLite backup: ${dbPath}`);

  db.close();
  console.log("Backup complete.");
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
