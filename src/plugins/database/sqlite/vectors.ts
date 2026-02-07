import type { Database } from "bun:sqlite";
import { getLogger } from "../../../core/logger";

export class VectorRepository {
  private available = false;

  constructor(private db: Database) {
    try {
      this.db.exec("SELECT vec_version()");
      this.available = true;
      getLogger().info("sqlite-vec extension available");
    } catch {
      getLogger().info(
        "sqlite-vec not available — vector search disabled, using FTS5 + recency only",
      );
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  saveVecMemory(memoryId: number, embedding: number[]): void {
    if (!this.available) return;
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO vec_memories (memory_id, embedding) VALUES ($id, $embedding)`,
        )
        .run({
          $id: memoryId,
          $embedding: JSON.stringify(embedding),
        });
    } catch (err) {
      getLogger().warn({ err }, "Failed to save memory vector");
    }
  }

  saveVecGoal(goalId: number, embedding: number[]): void {
    if (!this.available) return;
    try {
      this.db
        .prepare(`INSERT OR REPLACE INTO vec_goals (goal_id, embedding) VALUES ($id, $embedding)`)
        .run({
          $id: goalId,
          $embedding: JSON.stringify(embedding),
        });
    } catch (err) {
      getLogger().warn({ err }, "Failed to save goal vector");
    }
  }

  searchMemories(embedding: number[], limit: number): Array<{ id: number; distance: number }> {
    if (!this.available) return [];
    try {
      return this.db
        .prepare(
          `SELECT memory_id as id, distance FROM vec_memories WHERE embedding MATCH $embedding ORDER BY distance LIMIT $limit`,
        )
        .all({
          $embedding: JSON.stringify(embedding),
          $limit: limit,
        }) as Array<{ id: number; distance: number }>;
    } catch (err) {
      getLogger().warn({ err }, "Vector memory search failed");
      return [];
    }
  }

  searchGoals(embedding: number[], limit: number): Array<{ id: number; distance: number }> {
    if (!this.available) return [];
    try {
      return this.db
        .prepare(
          `SELECT goal_id as id, distance FROM vec_goals WHERE embedding MATCH $embedding ORDER BY distance LIMIT $limit`,
        )
        .all({
          $embedding: JSON.stringify(embedding),
          $limit: limit,
        }) as Array<{ id: number; distance: number }>;
    } catch (err) {
      getLogger().warn({ err }, "Vector goal search failed");
      return [];
    }
  }

  deleteVecMemory(memoryId: number): void {
    if (!this.available) return;
    try {
      this.db.prepare(`DELETE FROM vec_memories WHERE memory_id = $id`).run({ $id: memoryId });
    } catch {
      /* ignore */
    }
  }

  deleteVecGoal(goalId: number): void {
    if (!this.available) return;
    try {
      this.db.prepare(`DELETE FROM vec_goals WHERE goal_id = $id`).run({ $id: goalId });
    } catch {
      /* ignore */
    }
  }

  // ─── Stage 3: Vault vectors ─────────────────────────────────

  saveVecVault(docId: number, embedding: number[]): void {
    if (!this.available) return;
    try {
      this.db
        .prepare(`INSERT OR REPLACE INTO vec_vault (doc_id, embedding) VALUES ($id, $embedding)`)
        .run({
          $id: docId,
          $embedding: JSON.stringify(embedding),
        });
    } catch (err) {
      getLogger().warn({ err }, "Failed to save vault vector");
    }
  }

  searchVault(embedding: number[], limit: number): Array<{ id: number; distance: number }> {
    if (!this.available) return [];
    try {
      return this.db
        .prepare(
          `SELECT doc_id as id, distance FROM vec_vault WHERE embedding MATCH $embedding ORDER BY distance LIMIT $limit`,
        )
        .all({
          $embedding: JSON.stringify(embedding),
          $limit: limit,
        }) as Array<{ id: number; distance: number }>;
    } catch (err) {
      getLogger().warn({ err }, "Vector vault search failed");
      return [];
    }
  }

  deleteVecVault(docId: number): void {
    if (!this.available) return;
    try {
      this.db.prepare(`DELETE FROM vec_vault WHERE doc_id = $id`).run({ $id: docId });
    } catch {
      /* ignore */
    }
  }
}
