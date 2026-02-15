import type { Database } from "bun:sqlite";
import type { Memory } from "../../../core/interfaces";

export class MemoryRepository {
  private stmtInsert;
  private stmtGetActive;
  private stmtGetAll;
  private stmtGetById;
  private stmtSoftDelete;
  private stmtFindExact;
  private stmtSearchFTS;

  constructor(private db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO memories (category, content, source_message_id, active, confidence)
      VALUES ($category, $content, $source_message_id, $active, $confidence)
    `);

    this.stmtGetActive = db.prepare(`
      SELECT * FROM memories
      WHERE active = 1
      ORDER BY id DESC
      LIMIT $limit
    `);

    this.stmtGetAll = db.prepare(`
      SELECT * FROM memories
      ORDER BY id DESC
      LIMIT $limit
    `);

    this.stmtGetById = db.prepare(`
      SELECT * FROM memories WHERE id = $id
    `);

    this.stmtSoftDelete = db.prepare(`
      UPDATE memories SET active = 0, updated_at = datetime('now') WHERE id = $id
    `);

    this.stmtFindExact = db.prepare(`
      SELECT * FROM memories WHERE content = $content AND active = 1 LIMIT 1
    `);

    this.stmtSearchFTS = db.prepare(`
      SELECT m.*, rank
      FROM fts_memories f
      JOIN memories m ON m.id = f.rowid
      WHERE fts_memories MATCH $query AND m.active = 1
      ORDER BY rank
      LIMIT $limit
    `);
  }

  saveMemory(memory: Memory): number {
    this.stmtInsert.run({
      $category: memory.category,
      $content: memory.content,
      $source_message_id: memory.source_message_id ?? null,
      $active: memory.active ?? 1,
      $confidence: memory.confidence,
    });
    return (this.db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  }

  getMemories(options: { active?: boolean; limit?: number }): Memory[] {
    const limit = options.limit ?? 50;
    if (options.active !== false) {
      return this.stmtGetActive.all({ $limit: limit }) as Memory[];
    }
    return this.stmtGetAll.all({ $limit: limit }) as Memory[];
  }

  getMemoryById(id: number): Memory | null {
    return (this.stmtGetById.get({ $id: id }) as Memory) ?? null;
  }

  updateMemory(id: number, updates: Partial<Memory>): void {
    const allowed = ["category", "content", "active", "confidence"];
    const sets: string[] = [];
    const params: Record<string, string | number | null> = { $id: id };
    for (const key of allowed) {
      if (key in updates) {
        sets.push(`${key} = $${key}`);
        params[`$${key}`] = (updates as Record<string, string | number | null>)[key];
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db.prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = $id`).run(params);
  }

  deleteMemory(id: number): void {
    this.stmtSoftDelete.run({ $id: id });
  }

  searchMemoriesFTS(query: string, limit: number): Memory[] {
    // Escape FTS5 special characters
    const safeQuery = query.replace(/['"*():]/g, " ").trim();
    if (!safeQuery) return [];
    try {
      return this.stmtSearchFTS.all({
        $query: safeQuery,
        $limit: limit,
      }) as Memory[];
    } catch {
      return [];
    }
  }

  checkExactDuplicate(content: string): Memory | null {
    return (this.stmtFindExact.get({ $content: content }) as Memory) ?? null;
  }
}
