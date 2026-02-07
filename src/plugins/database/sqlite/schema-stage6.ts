export const STAGE6_DDL_CORE = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'running', 'completed', 'error', 'deleted')),
  user_id TEXT NOT NULL,
  last_task_prompt TEXT,
  last_task_result TEXT,
  last_task_duration_ms INTEGER,
  last_task_turns INTEGER,
  last_task_cost_usd REAL,
  total_cost_usd REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS code_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  prompt TEXT NOT NULL,
  result_text TEXT,
  success INTEGER,
  duration_ms INTEGER,
  num_turns INTEGER,
  cost_usd REAL,
  exit_code INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_code_tasks_project ON code_tasks(project_id);
`;
