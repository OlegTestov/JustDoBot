import type { Database } from "bun:sqlite";
import type { VaultDocument } from "../../../core/interfaces";

export class VaultRepository {
  private stmtUpsert;
  private stmtGetByPath;
  private stmtGetHashByPath;
  private stmtDeleteByPath;
  private stmtSearchFTS;
  private stmtCount;
  private stmtGetAll;
  private stmtGetById;

  constructor(private db: Database) {
    this.stmtUpsert = db.prepare(`
      INSERT INTO vault_documents (file_path, chunk_index, title, content, content_hash, metadata)
      VALUES ($file_path, $chunk_index, $title, $content, $content_hash, $metadata)
      ON CONFLICT(file_path, chunk_index) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        content_hash = excluded.content_hash,
        metadata = excluded.metadata,
        indexed_at = datetime('now')
    `);

    this.stmtGetByPath = db.prepare(`
      SELECT * FROM vault_documents WHERE file_path = $file_path ORDER BY chunk_index
    `);

    this.stmtGetHashByPath = db.prepare(`
      SELECT content_hash FROM vault_documents WHERE file_path = $file_path AND chunk_index = 0 LIMIT 1
    `);

    this.stmtDeleteByPath = db.prepare(`
      DELETE FROM vault_documents WHERE file_path = $file_path
    `);

    this.stmtSearchFTS = db.prepare(`
      SELECT v.*, rank
      FROM fts_vault f
      JOIN vault_documents v ON v.id = f.rowid
      WHERE fts_vault MATCH $query
      ORDER BY rank
      LIMIT $limit
    `);

    this.stmtCount = db.prepare(`
      SELECT COUNT(*) as count FROM vault_documents
    `);

    this.stmtGetAll = db.prepare(`
      SELECT * FROM vault_documents ORDER BY file_path, chunk_index LIMIT $limit
    `);

    this.stmtGetById = db.prepare(`
      SELECT * FROM vault_documents WHERE id = $id
    `);
  }

  upsertDocument(doc: VaultDocument): number {
    this.stmtUpsert.run({
      $file_path: doc.file_path,
      $chunk_index: doc.chunk_index,
      $title: doc.title,
      $content: doc.content,
      $content_hash: doc.content_hash,
      $metadata: doc.metadata ?? null,
    });
    return (this.db.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  }

  getDocumentsByPath(filePath: string): VaultDocument[] {
    return this.stmtGetByPath.all({ $file_path: filePath }) as VaultDocument[];
  }

  getById(id: number): VaultDocument | null {
    return (this.stmtGetById.get({ $id: id }) as VaultDocument) ?? null;
  }

  getHashByPath(filePath: string): string | null {
    const row = this.stmtGetHashByPath.get({ $file_path: filePath }) as {
      content_hash: string;
    } | null;
    return row?.content_hash ?? null;
  }

  deleteByPath(filePath: string): void {
    this.stmtDeleteByPath.run({ $file_path: filePath });
  }

  deleteStaleChunks(filePath: string, maxChunkIndex: number): void {
    this.db
      .prepare(`DELETE FROM vault_documents WHERE file_path = $file_path AND chunk_index > $max`)
      .run({ $file_path: filePath, $max: maxChunkIndex });
  }

  searchFTS(query: string, limit: number): VaultDocument[] {
    const safeQuery = query.replace(/['"*():]/g, " ").trim();
    if (!safeQuery) return [];
    try {
      return this.stmtSearchFTS.all({
        $query: safeQuery,
        $limit: limit,
      }) as VaultDocument[];
    } catch {
      return [];
    }
  }

  getDocumentCount(): number {
    return (this.stmtCount.get() as { count: number }).count;
  }

  getAllDocuments(limit = 100): VaultDocument[] {
    return this.stmtGetAll.all({ $limit: limit }) as VaultDocument[];
  }
}
