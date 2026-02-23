// Stage 2 DDL — memories, goals, FTS5 indexes, vector tables
// All use IF NOT EXISTS for safe migration from Stage 1

export const STAGE2_DDL_CORE = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'fact'
    CHECK (category IN ('fact', 'preference', 'person', 'insight')),
  content TEXT NOT NULL,
  source_message_id INTEGER REFERENCES messages(id),
  active INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.8,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(active);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  deadline TEXT,
  progress_notes TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

-- FTS5 for memories
CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories USING fts5(
  content, content='memories', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS fts_memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO fts_memories(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS fts_memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO fts_memories(fts_memories, rowid, content)
    VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS fts_memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO fts_memories(fts_memories, rowid, content)
    VALUES('delete', old.id, old.content);
  INSERT INTO fts_memories(rowid, content) VALUES (new.id, new.content);
END;

-- FTS5 for goals
CREATE VIRTUAL TABLE IF NOT EXISTS fts_goals USING fts5(
  title, description, content='goals', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS fts_goals_ai AFTER INSERT ON goals BEGIN
  INSERT INTO fts_goals(rowid, title, description)
    VALUES (new.id, new.title, COALESCE(new.description, ''));
END;
CREATE TRIGGER IF NOT EXISTS fts_goals_ad AFTER DELETE ON goals BEGIN
  INSERT INTO fts_goals(fts_goals, rowid, title, description)
    VALUES('delete', old.id, old.title, COALESCE(old.description, ''));
END;
CREATE TRIGGER IF NOT EXISTS fts_goals_au AFTER UPDATE ON goals BEGIN
  INSERT INTO fts_goals(fts_goals, rowid, title, description)
    VALUES('delete', old.id, old.title, COALESCE(old.description, ''));
  INSERT INTO fts_goals(rowid, title, description)
    VALUES (new.id, new.title, COALESCE(new.description, ''));
END;
`;

// Vector tables — only executed if sqlite-vec is available
export function stage2VecDDL(dimensions: number): string {
  return `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
  memory_id INTEGER PRIMARY KEY,
  embedding float[${dimensions}]
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_goals USING vec0(
  goal_id INTEGER PRIMARY KEY,
  embedding float[${dimensions}]
);
`;
}
