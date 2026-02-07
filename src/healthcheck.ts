import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const DB_PATH = process.env.DB_PATH ?? "./data/bot.db";

try {
  if (!existsSync(DB_PATH)) {
    console.error("Database not found:", DB_PATH);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  db.exec("SELECT 1");
  db.close();

  process.exit(0);
} catch (err) {
  console.error("Healthcheck failed:", err);
  process.exit(1);
}
