export const STAGE1_DDL = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  telegram_message_id INTEGER,
  media_type TEXT,
  media_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(
  content, content='messages', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS fts_messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO fts_messages(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS fts_messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO fts_messages(fts_messages, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS fts_messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO fts_messages(fts_messages, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO fts_messages(rowid, content) VALUES (new.id, new.content);
END;
`;
