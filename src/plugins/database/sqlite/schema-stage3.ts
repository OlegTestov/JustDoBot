// Stage 3 DDL — vault documents, FTS5 indexes, vector tables
// All use IF NOT EXISTS for safe migration from Stage 2

export const STAGE3_DDL_CORE = `
CREATE TABLE IF NOT EXISTS vault_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata TEXT,
  indexed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(file_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_vault_file_path ON vault_documents(file_path);
CREATE INDEX IF NOT EXISTS idx_vault_hash ON vault_documents(content_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_vault USING fts5(
  content, title, content='vault_documents', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS fts_vault_ai AFTER INSERT ON vault_documents BEGIN
  INSERT INTO fts_vault(rowid, content, title)
    VALUES (new.id, new.content, COALESCE(new.title, ''));
END;
CREATE TRIGGER IF NOT EXISTS fts_vault_ad AFTER DELETE ON vault_documents BEGIN
  INSERT INTO fts_vault(fts_vault, rowid, content, title)
    VALUES('delete', old.id, old.content, COALESCE(old.title, ''));
END;
CREATE TRIGGER IF NOT EXISTS fts_vault_au AFTER UPDATE ON vault_documents BEGIN
  INSERT INTO fts_vault(fts_vault, rowid, content, title)
    VALUES('delete', old.id, old.content, COALESCE(old.title, ''));
  INSERT INTO fts_vault(rowid, content, title)
    VALUES (new.id, new.content, COALESCE(new.title, ''));
END;
`;

// Vector table — only executed if sqlite-vec is available
export function stage3VecDDL(dimensions: number): string {
  return `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_vault USING vec0(
  doc_id INTEGER PRIMARY KEY,
  embedding float[${dimensions}]
);
`;
}
