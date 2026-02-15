# JustDoBot — Architecture Document

## Overview

JustDoBot is a personal AI assistant Telegram bot built with a plugin architecture.
It combines real-time streaming responses, persistent memory, goal tracking,
semantic search, and proactive behavior to maintain context across conversations.

**Stack:** Bun + Grammy + Claude Agent SDK + SQLite (FTS5 + sqlite-vec)

**Stage:** 6 of 6 (MVP + Memory + Obsidian + Proactive + Voice + Code Agent)

---

## Project Structure

```
JustDoBot/
├── src/
│   ├── index.ts                    # Orchestrator: wires plugins, handles message loop
│   ├── config.ts                   # YAML config loader with Zod validation
│   ├── registry.ts                 # Plugin lifecycle manager
│   ├── healthcheck.ts              # Docker health check endpoint
│   │
│   ├── locales/                     # Bot response translations (15 languages)
│   │   ├── index.ts               # createTranslator(), Translator type, LANGUAGE_NAMES
│   │   ├── en.json                # English — source of truth (~112 keys)
│   │   ├── ru.json                # Russian
│   │   ├── ar.json                # Arabic
│   │   ├── zh.json                # Chinese (Simplified)
│   │   ├── de.json                # German
│   │   ├── es.json                # Spanish
│   │   ├── fr.json                # French
│   │   ├── hi.json                # Hindi
│   │   ├── it.json                # Italian
│   │   ├── ja.json                # Japanese
│   │   ├── ko.json                # Korean
│   │   ├── pl.json                # Polish
│   │   ├── pt.json                # Portuguese
│   │   ├── tr.json                # Turkish
│   │   └── uk.json                # Ukrainian
│   │
│   ├── core/                       # Framework-agnostic business logic
│   │   ├── interfaces.ts           # All domain types and plugin contracts
│   │   ├── context-builder.ts      # Token-budgeted context assembly
│   │   ├── hybrid-search.ts        # FTS5 + vector + recency scoring
│   │   ├── session-manager.ts      # UUID-based session tracking with timeout + getLastActivity()
│   │   ├── message-queue.ts        # Sequential async task processing + shared queryLock
│   │   ├── message-splitter.ts     # Telegram 4096-char chunking
│   │   ├── safe-markdown.ts        # Markdown -> Telegram HTML converter
│   │   ├── error-handler.ts        # Exponential backoff retry
│   │   ├── logger.ts              # Pino logger singleton
│   │   ├── gating-query.ts        # Claude structured output gating (Zod + JSON schema)
│   │   ├── proactive-scheduler.ts # Interval-based proactive check-in scheduler
│   │   └── format-date.ts        # Locale-aware date/time formatting helper
│   │
│   ├── plugins/
│   │   ├── ai-engines/claude-sdk/
│   │   │   ├── index.ts            # ClaudeSdkEngine — streaming + structured query runner
│   │   │   ├── mcp-memory.ts       # MCP tools: 3 memory + 3 goal (save/edit/delete + save/edit/close)
│   │   │   ├── mcp-twilio.ts      # MCP tool: make_phone_call (Twilio outbound call)
│   │   │   ├── oauth-refresh.ts    # Claude OAuth credentials injection + scheduled fetch refresh
│   │   │   └── prompts.ts          # System prompt construction (incl. check-in logs)
│   │   │
│   │   ├── database/sqlite/
│   │   │   ├── index.ts            # SqliteMemoryProvider — unified DB facade
│   │   │   ├── schema.ts           # Stage 1 DDL (messages + FTS5)
│   │   │   ├── schema-stage2.ts    # Stage 2 DDL (memories, goals, vectors)
│   │   │   ├── schema-stage3.ts    # Stage 3 DDL (vault_documents, fts_vault, vec_vault)
│   │   │   ├── schema-stage4.ts    # Stage 4 DDL (check_in_logs, quiet_mode)
│   │   │   ├── schema-stage6.ts    # Stage 6 DDL (projects, code_tasks)
│   │   │   ├── check-ins.ts        # CheckInRepository (save/query logs, quiet mode)
│   │   │   ├── messages.ts         # MessageRepository
│   │   │   ├── memories.ts         # MemoryRepository (CRUD + FTS5)
│   │   │   ├── goals.ts            # GoalRepository (CRUD + editGoal + FTS5)
│   │   │   ├── vault.ts            # VaultRepository (CRUD + FTS5)
│   │   │   ├── vectors.ts          # VectorRepository (sqlite-vec)
│   │   │   ├── projects.ts         # ProjectRepository (CRUD, status, cost tracking)
│   │   │   └── code-tasks.ts       # CodeTaskRepository (task log, history)
│   │   │
│   │   ├── collectors/              # Stage 4: Data source collectors
│   │   │   ├── google/
│   │   │   │   ├── oauth.ts        # GoogleOAuthClient — token management, refresh
│   │   │   │   ├── gmail.ts        # GmailClient — important unread emails
│   │   │   │   ├── calendar.ts     # CalendarClient — upcoming events
│   │   │   │   └── index.ts        # GoogleCollectorProvider — ICollector facade
│   │   │   ├── goals/
│   │   │   │   └── index.ts        # GoalsCollector — active goals with approaching deadlines
│   │   │   └── vault/
│   │   │       └── index.ts        # VaultChangesCollector — recently modified vault docs
│   │   │
│   │   ├── vault/obsidian/
│   │   │   ├── index.ts            # ObsidianVaultProvider — IVaultProvider facade
│   │   │   ├── parser.ts           # Markdown/PDF parser (frontmatter, wiki-links)
│   │   │   ├── chunker.ts          # Header-based document chunker with overlap
│   │   │   ├── indexer.ts          # Incremental vault indexer (scan → parse → chunk → embed)
│   │   │   └── watcher.ts          # File watcher (poll or native fs.watch)
│   │   │
│   │   ├── messengers/telegram/
│   │   │   ├── index.ts            # TelegramMessenger — Grammy bot setup
│   │   │   ├── streaming.ts        # StreamingResponseHandler (live edits)
│   │   │   ├── handlers/
│   │   │   │   ├── commands.ts     # /start /help /clear /cancel /goals /memory /forget /backup /vault /note /reindex /quiet /status /projects /project_stop /project_delete
│   │   │   │   ├── text.ts         # Text message -> AI pipeline
│   │   │   │   ├── media.ts        # Photo/document handler
│   │   │   │   ├── voice.ts        # Voice/audio → STT → handler pipeline
│   │   │   │   └── callbacks.ts    # Inline button callbacks (TTS skip/listen)
│   │   │   └── middleware/
│   │   │       ├── auth.ts         # User/chat whitelist, group mention mode, ID hint
│   │   │       ├── logging.ts      # Update logging
│   │   │       └── rate-limit.ts   # 1/sec, 100/hour per user (shows minutes until reset)
│   │   │
│   │   ├── voice/
│   │   │   ├── gemini-stt/        # Gemini 2.5 Flash STT provider
│   │   │   ├── elevenlabs-tts/    # ElevenLabs TTS provider (ogg_opus)
│   │   │   ├── gemini-tts/        # Gemini TTS provider (PCM→OGG via ffmpeg)
│   │   │   └── twilio-calls/      # Twilio outbound call provider (proactive + MCP tool)
│   │   │
│   │   ├── code-executor/
│   │   │   ├── docker/
│   │   │   │   ├── index.ts        # DockerCodeExecutor — ICodeExecutor, task lifecycle
│   │   │   │   ├── manager.ts      # Docker CLI wrapper, sandbox stack management
│   │   │   │   ├── Dockerfile.sandbox  # Sandbox image (Node 22, Bun, Python 3, Claude CLI)
│   │   │   │   └── entrypoint.sh   # Git config, proxy env setup
│   │   │   ├── ndjson-parser.ts    # NDJSON stream parser for Claude Code output
│   │   │   └── mcp-code-task.ts    # MCP tool: start_coding_task
│   │   │
│   │   └── embeddings/openai/
│   │       └── index.ts            # OpenAI text-embedding-3-small provider
│   │
│   └── types/
│       ├── pdf-parse.d.ts
│       └── mammoth.d.ts
│
├── tests/
│   ├── core/
│   │   ├── config.test.ts                # 8 tests (YAML config loading + Zod validation)
│   │   ├── context-builder.test.ts       # 11 tests
│   │   ├── context-builder-vault.test.ts # 5 tests
│   │   ├── hybrid-search.test.ts         # 5 tests
│   │   ├── message-splitter.test.ts      # 8 tests
│   │   ├── safe-markdown.test.ts         # 6 tests
│   │   ├── session-manager.test.ts       # 5 tests
│   │   ├── proactive-scheduler.test.ts   # 26 tests (isQuietHours, scheduler lifecycle, collectors)
│   │   ├── gating-query.test.ts          # 8 tests (schema + runGatingQuery)
│   │   ├── message-queue-lock.test.ts    # 3 tests (queryLock mutex)
│   │   └── message-queue-stress.test.ts  # 4 tests (concurrent load, error isolation)
│   ├── plugins/
│   │   ├── mcp-memory.test.ts            # 18 tests
│   │   ├── memory-repo.test.ts           # 21 tests
│   │   ├── vault-parser.test.ts          # 12 tests
│   │   ├── vault-chunker.test.ts         # 8 tests
│   │   ├── vault-repo.test.ts            # 11 tests
│   │   ├── vault-indexer.test.ts         # 7 tests
│   │   ├── check-ins.test.ts            # 16 tests (CheckInRepository + quiet mode)
│   │   ├── gemini-stt.test.ts           # 6 tests
│   │   ├── elevenlabs-tts.test.ts       # 5 tests
│   │   ├── gemini-tts.test.ts           # 5 tests
│   │   ├── voice-handler.test.ts        # 7 tests
│   │   ├── callbacks.test.ts            # 6 tests
│   │   ├── twilio-calls.test.ts         # 5 tests
│   │   ├── code-task-repo.test.ts      # 3 tests (CodeTaskRepository CRUD)
│   │   ├── project-repo.test.ts        # 11 tests (ProjectRepository CRUD + status)
│   │   ├── squid-config.test.ts        # 4 tests (Squid whitelist config generation)
│   │   └── ndjson-parser.test.ts       # 9 tests (Claude stream-json parsing)
│   ├── commands/
│   │   └── status.test.ts              # 5 tests
│   └── integration/
│       └── message-flow.test.ts          # 5 tests
│
├── scripts/
│   ├── setup.ts                       # Interactive terminal setup wizard
│   ├── setup-core.ts                  # Shared setup logic (validation, generation, DB init)
│   ├── docker-start.ts                # Docker entry helper: detect Claude creds, save, compose up --build
│   ├── web-setup.ts                   # Web setup panel — Bun HTTP server (port 19380)
│   ├── web-setup.html                 # Web setup panel — HTML markup (6-step wizard)
│   ├── web-setup.css                  # Web setup panel — styles (dark theme)
│   ├── web-setup.js                   # Web setup panel — client JS (i18n, navigation, API calls)
│   ├── doctor.ts                      # Diagnostics: 12 base checks (14 with Code Agent enabled)
│   ├── re-embed.ts                    # Backfill embeddings for existing data
│   └── i18n/                          # Setup wizard translations (15 languages)
│       ├── en.json                    # English — source of truth (~193 keys)
│       ├── ru.json                    # Russian
│       ├── zh.json                    # Chinese (Simplified)
│       ├── es.json                    # Spanish
│       ├── pt.json                    # Portuguese
│       ├── de.json                    # German
│       ├── fr.json                    # French
│       ├── ja.json                    # Japanese
│       ├── ko.json                    # Korean
│       ├── it.json                    # Italian
│       ├── tr.json                    # Turkish
│       ├── hi.json                    # Hindi
│       ├── ar.json                    # Arabic (RTL)
│       ├── pl.json                    # Polish
│       └── uk.json                    # Ukrainian
│
├── lib/
│   └── libsqlite3.dylib              # Pre-built SQLite with loadExtension (macOS universal binary)
├── install.sh                         # One-command installer (curl | bash)
├── docker-entrypoint.sh               # Docker credentials bootstrap (CLAUDE_CREDENTIALS_B64 → ~/.claude)
├── README.md
├── config.example.yaml
├── .env.example
├── biome.json
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## Plugin Architecture

All plugins implement `IPlugin`:

```
IPlugin { name, version, init(config), destroy(), healthCheck() }
    ├── IAIEngine          — queryStream(), queryStructured(), abort()
    ├── IMemoryProvider    — messages, memories, goals (incl. editGoal), vectors, vault
    ├── IMessenger         — start(), stop(), sendMessage(), onMessage()
    ├── IEmbeddingProvider — embed(), embedBatch(), dimensions
    ├── IVaultProvider     — index(), search(), startWatching(), stopWatching()
    ├── ICollector         — collect(), type (email/calendar/goals/vault/custom)
    ├── ISTTProvider       — transcribe(audio, format, language?)
    ├── ITTSProvider       — synthesize(text, language?)
    └── ICodeExecutor      — runTaskInBackground(), cancelTask(), project CRUD
```

`PluginRegistry` manages lifecycle:
- `register(type, plugin)` — stores plugin
- `initAll(config)` — initializes in registration order
- `destroyAll()` — destroys in reverse order
- `healthCheckAll()` — checks all plugins

---

## Message Processing Pipeline

```
Telegram Update
  │
  ▼
Middleware: logging → auth → rate-limit
  │
  ▼
MessageQueue.enqueue()          ← serializes globally (single queue)
  │                                acquires shared queryLock (mutex)
  ▼
SessionManager.getSessionId()   ← UUID with 6h timeout
  │
  ▼
database.saveMessage(role: "user")
  │
  ▼
buildContext()                   ← token-budgeted context assembly
  │  ├── getRecentMessages()       (40% budget)
  │  ├── hybridSearchMemories()    (15% budget)
  │  ├── getActiveGoals()          (7% budget)
  │  ├── vaultProvider.search()    (25% budget)
  │  ├── checkInRepo.getRecentLogs() (5% budget)
  │  └── redistribute unused       (empty categories → more messages)
  │
  ▼
buildSystemPrompt(botName, context, t, options)  ← injects memories, goals, history, check-ins, tool docs
  │
  ▼
ClaudeSdkEngine.queryStream()
  │  ├── MCP tools: save/edit/delete_memory, save/edit/close_goal, start_coding_task, make_phone_call
  │  ├── Timeout protection (configurable)
  │  └── AbortController for /cancel
  │
  ▼
StreamingResponseHandler
  │  ├── Typing indicator (every 4s)
  │  ├── First chunk → new message
  │  ├── Subsequent → debounced editMessage
  │  └── finalize() → Markdown→HTML, split if >4096 chars
  │
  ▼
database.saveMessage(role: "assistant")
```

---

## Proactive Scheduler

The `ProactiveScheduler` runs on a configurable interval (default 5 min) and
decides whether to send a proactive message to the user.

```
setInterval (every check_interval_minutes)
  │
  ▼
Hard Gate 1: Queue busy?      → DEFER (retry after defer_minutes)
  │
  ▼
Hard Gate 2: Quiet hours?     → SKIP (log, no retry)
  │
  ▼
Hard Gate 3: Cooldown active? → SKIP (last sent < cooldown_minutes ago)
  │
  ▼
Hard Gate 4: Quiet mode?      → SKIP (user set via /quiet command)
  │
  ▼
Hard Gate 5: Active chat?     → SKIP (user active in last defer_minutes)
  │
  ▼
Collect data from all ICollectors
  │  ├── GoalsCollector     — active goals with deadlines ≤ 3 days
  │  ├── VaultChangesCollector — recently modified vault docs (24h)
  │  └── GoogleCollectorProvider (optional)
  │     ├── GmailClient    — important unread emails
  │     └── CalendarClient  — upcoming events (24h)
  │
  ▼
Empty data guard → SKIP (no Claude call when all collectors return empty)
  │
  ▼
Pre-check hash (SHA-256 of stable-sorted JSON)
  │  └── Same as last check? → SKIP (no Claude call)
  │
  ▼
Acquire shared queryLock (same mutex as message queue)
  │
  ▼
runGatingQuery(hasTwilio) → Claude structured output (JSON schema via Zod)
  │  ├── action: "text" → Send Telegram message, log in check_in_logs
  │  │   └── urgency >= urgency_threshold (default 8)? → Also make phone call
  │  ├── action: "call" → Send Telegram message + make phone call (emergency)
  │  └── action: "skip" → Log skip reason, release lock
  │
  ▼
Release queryLock
```

**Key design decisions:**
- Shared `queryLock` in `MessageQueue` prevents concurrent SDK calls between scheduler and message handler
- Gating query uses `outputFormat: { type: "json_schema" }` with Zod → `zod-to-json-schema` conversion
- Gating query actions: `text` (Telegram only), `call` (Telegram + phone call), `skip` (no action)
- Phone calls triggered in two ways: AI explicitly returns `action: "call"`, or `urgency >= urgency_threshold` (default 8)
- Twilio integration is optional — if not configured, `hasTwilio=false` and `"call"` option is hidden from the gating prompt
- `isQuietHours()` exported as pure function for testability, timezone-aware via `Intl.DateTimeFormat`
- Google OAuth tokens persisted in `./data/google-tokens.json`, auto-refreshed
- Google collector gracefully disabled if no OAuth tokens (never crashes)

---

## Data Model

### SQLite Schema

**Stage 1 — Messages**
```sql
messages (
  id            INTEGER PRIMARY KEY,
  session_id    TEXT NOT NULL,        -- UUID from SessionManager
  role          TEXT CHECK(user/assistant/system),
  content       TEXT NOT NULL,
  telegram_message_id  INTEGER,
  media_type    TEXT,
  media_url     TEXT,
  created_at    TEXT DEFAULT now
)
fts_messages   USING fts5(content)   -- auto-synced via triggers
```

**Stage 2 — Memories**
```sql
memories (
  id            INTEGER PRIMARY KEY,
  category      TEXT CHECK(fact/preference/person/insight),
  content       TEXT NOT NULL,
  source_message_id  INTEGER → messages(id),
  active        INTEGER DEFAULT 1,   -- soft delete
  confidence    REAL DEFAULT 0.8,
  created_at, updated_at
)
fts_memories   USING fts5(content)   -- auto-synced
```

**Stage 2 — Goals**
```sql
goals (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT CHECK(active/completed/paused/cancelled),
  deadline      TEXT,                 -- YYYY-MM-DD
  progress_notes TEXT DEFAULT '[]',   -- JSON array
  created_at, updated_at
)
fts_goals      USING fts5(title, description)  -- auto-synced
```

**Stage 3 — Vault Documents**
```sql
vault_documents (
  id            INTEGER PRIMARY KEY,
  file_path     TEXT NOT NULL,
  chunk_index   INTEGER NOT NULL DEFAULT 0,
  title         TEXT,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,       -- MD5, skip re-index if unchanged
  metadata      TEXT DEFAULT '{}',   -- JSON (frontmatter, wiki-links)
  indexed_at    TEXT DEFAULT now,
  UNIQUE(file_path, chunk_index)
)
fts_vault      USING fts5(title, content)  -- auto-synced via triggers
```

**Stage 4 — Check-in Logs**
```sql
check_in_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT,
  data_hash     TEXT NOT NULL,       -- SHA-256 of collected data (dedup)
  sources       TEXT NOT NULL,       -- JSON array of collector types
  gating_result TEXT NOT NULL CHECK(text/call/skip),
  skip_reason   TEXT,
  urgency       INTEGER,            -- 1-10 from Claude gating
  message_sent  TEXT,               -- proactive message content (if text)
  tokens_used   INTEGER,
  created_at    TEXT DEFAULT now
)
-- Indexes: created_at DESC, user_id
```

**Stage 6 — Projects & Code Tasks**
```sql
projects (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,   -- e.g. "snake-game"
  status        TEXT CHECK(active/running/error/deleted),
  user_id       TEXT,
  last_task_prompt    TEXT,
  last_task_result    TEXT,
  last_task_duration_ms  INTEGER,
  last_task_turns     INTEGER,
  last_task_cost_usd  REAL,
  total_cost_usd      REAL DEFAULT 0,
  created_at, updated_at
)

code_tasks (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER → projects(id),
  prompt        TEXT NOT NULL,
  result_text   TEXT,
  success       INTEGER,              -- 0/1
  duration_ms   INTEGER,
  num_turns     INTEGER,
  cost_usd      REAL,
  exit_code     INTEGER,
  created_at    TEXT DEFAULT now
)
-- Index: project_id + created_at DESC
```

**Stage 4 — Quiet Mode**
```sql
quiet_mode (
  user_id       TEXT PRIMARY KEY,
  until         TEXT NOT NULL,       -- ISO datetime, compared with datetime()
  set_at        TEXT DEFAULT now
)
```

**Vectors (sqlite-vec, optional)**
```sql
vec_memories (memory_id INTEGER PK, embedding float[1536])
vec_goals    (goal_id INTEGER PK,   embedding float[1536])
vec_vault    (doc_id INTEGER PK,    embedding float[1536])
```

---

## Hybrid Search Algorithm

Combines three signals to rank memories:

```
final_score = W_semantic * semantic + W_keyword * keyword + W_recency * recency
```

| Signal   | Source       | Scoring                                    |
|----------|-------------|--------------------------------------------|
| Keyword  | FTS5 search | Position-based: first=1.0, last=0.0        |
| Semantic | sqlite-vec  | 1.0 - cosine_distance (capped at 0)        |
| Recency  | created_at  | 1/(1 + age_days/30): today=1.0, 30d=0.5   |

**Weights:**
- With embeddings: semantic=0.4, keyword=0.4, recency=0.2
- Without embeddings: keyword=0.67, recency=0.33

---

## Vault Indexing Pipeline

Obsidian vault files are indexed incrementally into SQLite for hybrid search.

```
Vault directory scan
  │
  ├── Filter by include/exclude patterns
  │
  ▼
For each .md file:
  │
  ├── Parse: frontmatter (YAML) + content + title + wiki-links
  ├── MD5 hash → skip if unchanged (incremental)
  ├── Chunk: split by ## headers, then paragraphs if >1500 chars
  │          200-char overlap between chunks
  ├── Embed: embedBatch() via OpenAI (if available)
  └── Upsert: vault_documents + fts_vault + vec_vault
```

**File watching:** Two modes — `poll` (mtime scan, Docker-safe, default) and
`native` (fs.watch with 5s debounce per file, local dev).

**Vault search** uses the same hybrid scoring as memory search:
`score = 0.4 * semantic + 0.4 * keyword + 0.2 * recency`

---

## Code Agent (Stage 6)

User writes "Create a snake game" → bot launches Claude Code CLI in an isolated Docker sandbox →
Claude Code writes files, installs deps, runs tests → bot sends progress updates and final result to Telegram.

### Sandbox Architecture

```
Bot container (or host)
  │
  │  docker exec → Claude Code CLI
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  Docker sandbox stack                                    │
│                                                          │
│  ┌────────────────────────┐    ┌──────────────────────┐ │
│  │  Sandbox Container      │    │  Squid Proxy         │ │
│  │  (persistent)           │    │  (domain whitelist)  │ │
│  │                         │    │                      │ │
│  │  Claude Code CLI +      │───→│  anthropic.com ✅    │──→ Internet
│  │  Node 22, Bun, Python,  │    │  npmjs.org ✅        │    (filtered)
│  │  Git                    │    │  pypi.org ✅         │ │
│  │                         │    │  github.com ✅       │ │
│  │  /workspace/code/ (bind)│    │  * ❌                │ │
│  │  ~/.claude (volume)     │    │                      │ │
│  │                         │    │  Network: internal + │ │
│  │  Network: internal only │    │    external (bridge)  │ │
│  └────────────────────────┘    └──────────────────────┘ │
│                                                          │
│  Networks:                                               │
│    internal (--internal, no gateway) ← sandbox + proxy   │
│    external (bridge, internet)       ← proxy only        │
│                                                          │
│  Volumes:                                                │
│    ./workspace/code/ (bind) → /workspace/code/           │
│    justdobot-claude-data    → ~/.claude (sessions, creds)│
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
User: "Создай snake game на Python"
  │
  ▼
Claude (host) → MCP tool: start_coding_task("snake-game", prompt)
  │  1. Create/reuse project in DB
  │  2. Fire background task (NOT awaited)
  │  3. Return "Task started" → queryLock released
  │
  ═══ Background (parallel) ═══
  │
  ▼
docker exec -w /workspace/code/snake-game sandbox \
  claude -p "..." --dangerously-skip-permissions \
  --output-format stream-json --verbose \
  --continue --model sonnet --max-turns 50
  │
  ├─ NDJSON stream parsing (system/assistant/result events)
  ├─ onProgress (debounced 10s) → Telegram: "⚙️ Writing main.py..."
  │
  ▼
onComplete → Telegram: "✅ snake-game — Done! 45s · 6 turns · $0.12"
  │  + Delete button [🗑]
  │  + Save task to code_tasks table
```

### Network Isolation (Squid Proxy)

Sandbox is on an `--internal` Docker network (no default gateway — physically cannot reach the internet).
All traffic goes through Squid proxy on two networks (internal + external), filtering by domain whitelist.

Node.js `fetch`/undici don't respect `HTTP_PROXY` natively — `global-agent@3` is preloaded
via `NODE_OPTIONS=--require global-agent/bootstrap` to route all HTTP through the proxy.
Native tools (`npm`, `pip`, `curl`, `git`) respect `HTTP_PROXY` env var directly.

### Security Model

| Measure | Implementation | Purpose |
|---------|---------------|---------|
| Internal network | `--internal` flag, no gateway | No direct internet |
| Squid whitelist | Domain ACLs, CONNECT filtering | Only allowed domains |
| `--cap-drop ALL` | All capabilities dropped | No privileged ops |
| `--security-opt no-new-privileges` | No setuid/setgid | No privilege escalation |
| `--read-only` | Immutable root FS | Write only to /workspace, ~/.claude, tmpfs |
| `--user 1000:1000` | Non-root user | Minimal privileges |
| `--memory 4g` / `--cpus 2` | Resource limits | OOM killer, no CPU starvation |
| `--pids-limit 1024` | Process count limit | Fork bomb protection |
| `--tmpfs /home/coder` | Ephemeral home dir | No persistent leaks |
| Named volume for `~/.claude` | Credentials not bind-mounted | Can't modify host files |
| `--max-turns` + `timeout_minutes` | Task limits | No infinite loops |
| Project name regex | `^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$` | No path traversal |
| Workspace disk guard | `du -sm` check before each task | Bind mount won't fill host disk |
| Crash recovery | Reset stuck "running" projects on init | No zombie projects |

### Docker-in-Docker (DinD) Considerations

When the bot runs inside Docker (`docker compose up`), sandbox management goes through the host's
Docker socket. Volume paths must reference the **host filesystem**, not the bot container's filesystem.

- `WORKSPACE_HOST_PATH` — host path for workspace bind mount (default: `${PWD}/workspace`)
- `DATA_HOST_PATH` — host path for data dir (squid.conf mount) (default: `${PWD}/data`)
- `workspaceLocalPath` — container-local path for file I/O (always `./workspace`)
- Credential copy uses `docker exec -i -u 0` with stdin pipe (not `docker cp`) to handle UID mismatch
- Named volume `justdobot-claude-data` ownership fixed via `chown 1000:1000` on init

### Non-fatal Initialization

Code executor is initialized **after** `registry.initAll()` in a separate try/catch.
If sandbox setup fails (no Docker, no credentials, etc.), the bot continues working
normally — Code Agent feature is simply disabled. A startup notification is sent to
all allowed users via Telegram explaining the error.

### Delegation Pattern

The system prompt instructs Claude to **always delegate** coding tasks to the code agent
via `start_coding_task` — never read, edit, or modify files in `./workspace/code/` directly.
This prevents the host Claude from wasting turns (and budget) on file operations that the
sandboxed code agent handles more effectively.

---

## MCP Tools

Claude has access to 6 memory/goal tools + 1 code tool + 1 phone tool via up to three MCP servers.

### Memory tools (3)

| Tool | When | Key params |
|------|------|------------|
| **save_memory** | User shares facts, preferences, names | `content`, `category`, `confidence` (0-1) |
| **edit_memory** | User corrects a previously saved fact | `memoryId`, `content?`, `category?`, `confidence?` |
| **delete_memory** | User says "forget that", "that's wrong" | `memoryId` |

- `save_memory` checks exact duplicates → updates confidence if higher, else saves new
- `edit_memory` re-embeds vector if content changed
- `delete_memory` is a soft delete (sets `active=0`)
- Memory IDs shown in system prompt as `#N [category] content`

### Goal tools (3)

| Tool | When | Key params |
|------|------|------------|
| **save_goal** | User sets new intention: "I want...", "deadline is..." | `title`, `description?`, `deadline?` |
| **edit_goal** | User refines/corrects existing goal | `goalId?`, `title?` (fuzzy), `newTitle?`, `newDescription?`, `newDeadline?` |
| **close_goal** | User says "done", "cancel", "pause" | `goalId?`, `title?` (fuzzy), `action` (complete/pause/cancel/resume) |

- `edit_goal` and `close_goal` share a `resolveGoalId()` helper: use ID directly, or fuzzy FTS5 title search (0 → error, 1 → use it, >1 → ask user to disambiguate)
- `edit_goal` updates title/description/deadline in-place, appends edit note to `progress_notes` JSON, re-embeds vector, FTS5 auto-updated via trigger
- `close_goal` transitions goal status and appends progress note
- System prompt instructs AI to check Active Goals before creating duplicates

### make_phone_call (separate MCP server: twilio, optional)
- **When:** User explicitly asks: "call me", "remind me by phone", "позвони мне"
- **Params:** `message` (text to read aloud, 2-3 sentences), `reason?` (for logging)
- **Logic:** Calls `TwilioCallProvider.makeCall(userPhoneNumber, message, language)` using configured `voice.twilio.user_phone_number`
- **One-way:** User hears the message via TTS (Polly voices, 10 languages) but cannot respond
- **Only registered** when `voice.twilio.enabled` AND `voice.twilio.user_phone_number` is set

### start_coding_task (separate MCP server: code-executor)
- **When:** User asks to create a project, write code, build something
- **Params:** `project_name` (regex: `^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$`), `task_prompt` (10-10000 chars)
- **Logic:** Create project in DB → fire background task (NOT awaited) → return immediately
- **Background:** `docker exec` Claude Code CLI in sandbox → parse NDJSON stream → debounced progress to Telegram → save result to DB → send completion message with Delete button
- **Follow-up:** Reuse `project_name` → `--continue` flag → Claude Code resumes with full context

---

## Context Builder

Assembles prompt context within token budget (default 12000 tokens).

**Token estimation:** `ceil(text.length / 3)`

**Budget allocation:**

| Category        | Share | Usage                          |
|----------------|-------|--------------------------------|
| Recent messages | 40%   | Last N messages from session    |
| Memories        | 15%   | Hybrid search results           |
| Goals           | 7%    | Active goals                    |
| Vault docs      | 25%   | Obsidian vault search results   |
| Check-in logs   | 5%    | Recent proactive check-in logs  |
| Reserve         | 8%    | Unused buffer                   |

**Redistribution:** Unused budgets are redistributed to messages. If vault has
no results: +25%. If no check-in logs: +5%.

---

## Streaming UX

`StreamingResponseHandler` provides real-time response delivery:

1. **Typing indicator** — repeats every 4s while waiting
2. **Thinking timeout** — shows "Thinking..." if no response after N ms
3. **First chunk** — sends as new Telegram message
4. **Subsequent chunks** — edits existing message (debounced at configurable interval)
5. **Finalize** — converts Markdown to Telegram HTML, splits if >4096 chars
6. **Empty response** — if `fullText` is empty after all turns (tool-only response), deletes the "Thinking..." placeholder instead of editing with empty text
7. **Fallback** — if HTML parse fails, sends plain text
8. **Error handling** — catches "message is not modified" silently

> **Note:** `fullText` is only updated when `extractTextFromAssistant()` returns non-empty text, preserving the last meaningful response across multi-turn tool-use sequences.

---

## Installation & Setup

Three ways to install, from simplest to manual:

### 1. One-command installer (recommended)
```bash
curl -fsSL https://justdobot.com/install.sh | bash
```
Auto-installs Bun, Node.js (direct download from nodejs.org if no Homebrew), Claude CLI,
dependencies, then opens the web setup panel. Claude authentication is handled in the web panel (not in the terminal).

### 2. Web setup panel
```bash
bun run web-setup
```
Bun HTTP server on port 19380 (auto-increments if busy). Serves a 6-step SPA wizard:
1. **Essentials** — Telegram token (with API validation), User ID, language
2. **AI Model** — Sonnet / Opus / Haiku card selector
3. **Optional** — Semantic search (OpenAI), Obsidian vault, Voice (STT/TTS)
4. **Proactive** — Check-in toggle, interval/cooldown/quiet hours, Google OAuth
5. **Code Agent** — Enable toggle, model choice, max turns, timeout
6. **Save & Run** — Pre-save validation, config summary, diagnostics

API routes: `GET /api/status` (includes `projectDir`), `POST /api/validate-token`, `POST /api/save`, `POST /api/pre-validate`, `GET /api/doctor`, `GET /api/detect-vaults`, `GET /api/lang/:code`, `POST /api/google-auth-url`, `GET /oauth/callback`, `GET /api/google-status`, `GET /api/docker-status`, `GET /api/platform-info`

After saving, success panel shows terminal instructions ("close terminal, open new one") and run commands with the full project directory path (`cd /path/to/JustDoBot && bun run start`).

### 3. Terminal wizard
```bash
bun run setup
```
Interactive readline wizard — same logic via `setup-core.ts`.

### Shared setup logic (`setup-core.ts`)
Both wizards share: `WizardState` interface (incl. proactive + Google fields),
`validateTelegramToken()` (regex + Telegram API), `generateEnvFile()`,
`generateConfigYaml()`, `initializeDatabase()`, `checkEnvironment()`.

Claude Docker auth helpers also live here:
- `detectClaudeCredentials()` — auto-detects full Claude OAuth credentials
  (Keychain on macOS, `~/.claude/.credentials.json` on Linux, fallback file)
- `saveClaudeCredentials()` — persists full OAuth payload to
  `./secrets/claude-credentials.json` and generates `secrets/.docker-env`
  with base64-encoded credentials for Docker entrypoint injection

### Diagnostics
```bash
bun run doctor
```
12 base checks: Bun, Claude CLI, config.yaml (Zod), .env, TELEGRAM_BOT_TOKEN, ALLOWED_USER_ID,
Database (row counts), sqlite-vec, Telegram API, OpenAI API, Vault path,
Docker availability.
With Code Agent enabled, 2 additional checks run: sandbox image and Claude credentials (14 total).
Exit code 1 if any check fails. Also available via web panel (`/api/doctor`).

---

## Configuration

`config.yaml` with `${ENV_VAR}` substitution, validated by Zod (`safeParse` with
human-readable error messages pointing to the failing field path).

```yaml
bot:
  name: "JustDoBot"
  language: "en"              # en, ru, ar, zh, de, es, fr, hi, it, ja, ko, pl, pt, tr, uk
  timezone: "UTC"             # IANA timezone (auto-detected by web setup)

messenger:
  type: "telegram"
  token: "${TELEGRAM_BOT_TOKEN}"
  allowed_users: ["${ALLOWED_USER_ID}"]
  allowed_chats: []               # Group chat IDs to allow (empty = DMs only)
  group_mode: "mention_only"      # In groups: "mention_only" or "all_messages"
  mode: "polling"

ai_engine:
  type: "claude-agent-sdk"
  model: "claude-sonnet-4-5"
  max_turns: 10
  allowed_tools: ["Read", "Grep", "Glob", "Write", "Edit"]
  timeout_seconds: 120
  streaming: true

database:
  type: "sqlite"
  path: "./data/bot.db"

context:
  max_tokens: 12000
  session_timeout_hours: 6

streaming:
  enabled: true
  edit_debounce_ms: 1000
  thinking_timeout_ms: 2000

logging:
  level: "info"
  format: "pretty"

backup:
  enabled: false
  dir: "./backups"

# Optional — enabled via setup wizard
embedding:
  enabled: true
  model: "text-embedding-3-small"
  dimensions: 1536

# Optional — Obsidian vault integration (configured via setup wizard)
vault:
  enabled: false
  type: "obsidian"
  path: "${VAULT_PATH}"
  include: []                    # empty = all folders; populated by wizard scan
  exclude: []                    # dot-dirs auto-excluded; wizard adds user choices
  watch_mode: "poll"
  poll_interval_seconds: 60

# Optional — Proactive check-ins (Stage 4)
proactive:
  enabled: false
  check_interval_minutes: 5      # How often to collect data and decide
  cooldown_minutes: 15           # Minimum minutes between proactive messages
  defer_minutes: 5               # Retry delay when queue is busy
  quiet_hours:
    start: "22:00"               # No proactive messages from...
    end: "08:00"                 # ...until this time

# Optional — Voice messages (Stage 5)
voice:
  stt:
    enabled: false
    type: "gemini"               # Gemini 2.5 Flash
  tts:
    enabled: false
    type: "elevenlabs"           # elevenlabs or gemini
    auto_reply: true             # Auto-send voice reply to voice messages
    max_text_length: 4000        # Truncate text before TTS
  twilio:
    enabled: false               # Outbound calls via Twilio REST API
    phone_number: ""             # Twilio FROM number (your Twilio number)
    user_phone_number: ""        # Your phone number to call TO (e.g. "+1234567890")
    urgency_threshold: 8         # Proactive call when urgency >= this (1-10)

# Optional — Code Agent (Stage 6)
code_execution:
  enabled: false
  model: "sonnet"                # sonnet / haiku / opus
  allowed_tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"]
  max_turns: 50                  # 5-200, turns per task
  max_concurrent_tasks: 1        # 1-5
  max_projects: 10               # 1-50
  timeout_minutes: 10            # 1-60
  resources:
    memory: "4g"
    cpus: "2"
    pids_limit: 1024
  allowed_domains:               # Squid proxy whitelist
    - ".anthropic.com"
    - ".npmjs.org"
    - ".pypi.org"
    - ".github.com"
    # ... more in config.ts defaults
  git:
    enabled: false
    user_name: "JustDoBot"
    user_email: "bot@example.com"
    token: "${GITHUB_TOKEN}"

# Optional — Google integration for proactive check-ins
collectors:
  google:
    enabled: false
    client_id: "${GOOGLE_CLIENT_ID}"
    client_secret: "${GOOGLE_CLIENT_SECRET}"
    gmail:
      enabled: true
    calendar:
      enabled: true
```

---

## Localization (i18n)

Two independent translation layers, both covering 15 languages:
en, ru, ar, zh, de, es, fr, hi, it, ja, ko, pl, pt, tr, uk

### Bot responses (`src/locales/`)

All user-facing bot strings are localized via a `Translator` function.

**Architecture:**
- Flat JSON files in `src/locales/` — `en.json` is source of truth (~112 keys), other files mirror its structure
- Key format: `"section.element"` (e.g. `"cmd.start.greeting"`, `"error.auth"`, `"streaming.thinking"`)
- Dynamic values via `{variable}` placeholders (e.g. `"Hello! I'm {botName}"`)
- `createTranslator(lang)` returns a `Translator` closure with English fallback for missing keys
- `Translator` type: `(key: LocaleKey, vars?: Record<string, string | number>) => string`
- Keys are type-safe — `LocaleKey` is derived from `typeof en.json`
- `LANGUAGE_NAMES` constant exported from `src/locales/index.ts` for use in prompts

**Data flow:**
- `config.bot.language` → `createTranslator(lang)` → `t: Translator`
- `t` injected into `TelegramDeps` → commands, streaming, media handler
- `t` passed to `createAuthMiddleware()` and `createRateLimitMiddleware()` (optional, with string fallback)
- `t` passed to `buildSystemPrompt(botName, context, t)` for vault labels and response language rule
- System prompt includes `"Always respond in {languageName}"` based on `config.bot.language`

**Key categories:**
- `cmd.start.*`, `cmd.help.*`, `cmd.clear.*`, `cmd.cancel.*` — command responses
- `cmd.goals.*`, `cmd.memory.*`, `cmd.forget.*` — data management
- `cmd.vault.*`, `cmd.note.*`, `cmd.reindex.*`, `cmd.backup.*` — vault commands
- `cmd.quiet.*` — quiet mode command responses
- `cmd.status.*` — /status command responses
- `cmd.help.quiet`, `cmd.help.status`, `cmd.help.voice` — help texts
- `streaming.*` — "Thinking...", "Cancelled"
- `media.*` — file processing errors
- `error.*` — AI query errors
- `auth.*` — private bot message
- `rateLimit.*` — rate limit message
- `prompt.vault.*` — vault section labels in system prompt
- `prompt.checkIn.*` — check-in section labels in system prompt
- `voice.*` — voice processing messages (transcribing, empty, error, TTS buttons)

### Setup wizard (`scripts/i18n/`)

The web setup panel has its own independent translation system:

**Architecture:**
- Flat JSON files in `scripts/i18n/` — `en.json` is source of truth (~193 keys), other files mirror its structure
- Key format: `"section.element.property"` (e.g. `"step1.token.label"`, `"error.save.failed"`)
- Dynamic values via `{variable}` placeholders (e.g. `"Valid! Bot: @{username}"`)
- English is injected at serve time into `app.js` (zero-latency), other languages fetched via `GET /api/lang/:code` and cached client-side
- DOM elements use `data-i18n` (textContent), `data-i18n-html` (innerHTML), `data-i18n-placeholder` attributes
- JS function `t(key, vars)` resolves translations with English fallback
- Language persisted in `localStorage`, restored on page load
- Arabic (`ar`) triggers RTL layout via `dir="rtl"` on `<html>`

---

## Error Handling UX

- **Config errors** — Zod `safeParse` formats field paths: `"ai_engine.model: Required"`
- **Unauthorized users** — `/start` in private chat responds with their Telegram ID + instructions
- **Rate limit** — Shows minutes until reset: "Wait ~5 min"
- **AI query errors** — Contextual messages: auth (401), rate limit (429), timeout, generic

---

## sqlite-vec on macOS

Apple's built-in SQLite blocks `loadExtension()`. The solution:

1. `Database.setCustomSQLite(path)` must be called **before** any `new Database()`.
2. `SqliteMemoryProvider.ensureCustomSQLite()` handles this as a static one-time call.
3. Search order: Homebrew paths → bundled `lib/libsqlite3.dylib` (universal binary, arm64 + x86_64).
4. Installer tries `brew install sqlite` if Homebrew is available; bundled fallback covers machines without Homebrew.
5. `existsSync()` check before `setCustomSQLite()` prevents `dlopen` crash on missing files.
6. On Linux/Docker, Bun's built-in SQLite supports extensions natively.

---

## Graceful Shutdown

```
SIGTERM/SIGINT received
  │
  ├── proactiveScheduler.stop()   ← stop check-in interval
  ├── oauthRefreshManager.stop()  ← stop Claude OAuth refresh timer
  ├── vaultProvider.stopWatching()  ← stop file watcher
  ├── messenger.stop()              ← stop polling
  ├── queue.drain(15s timeout)      ← wait for in-flight messages
  ├── aiEngine.abort()              ← cancel running queries (if drain times out)
  ├── database.flush()              ← WAL checkpoint
  ├── codeExecutor.destroy()        ← stop sandbox containers (if enabled)
  └── registry.destroyAll()         ← reverse-order plugin cleanup
```

---

## Bot Commands

| Command             | Description                                  |
|---------------------|----------------------------------------------|
| `/start`            | Welcome message with feature overview        |
| `/help`             | Command reference                            |
| `/clear`            | Reset session (new conversation)             |
| `/cancel`           | Abort current AI response                    |
| `/goals`            | List active goals                            |
| `/memory [query]`   | List or search memories                      |
| `/forget <id>`      | Delete memory by ID (soft delete)            |
| `/backup`           | Full backup: JSON export + SQLite copy       |
| `/status`           | Bot uptime, stats, plugin health             |
| `/vault [query]`    | Show vault stats or search vault documents   |
| `/note <text>`      | Create new note in Temp Notes/ folder        |
| `/reindex`          | Trigger full vault reindexation              |
| `/quiet [hours]`    | Enable quiet mode (default 4h, `off` to disable) |
| `/projects`         | List all projects with status and stats            |
| `/project_stop <name>` | Cancel running task for project                 |
| `/project_delete <name>` | Delete project directory and mark as deleted |

---

## Code Quality

**Biome** — linter + formatter (single tool, no ESLint/Prettier).

```bash
bun run check        # typecheck + lint
bun run lint:fix     # auto-fix lint + format
```

Config: `biome.json` — recommended rules, only `noNonNullAssertion` disabled (116 usages across SQLite repos and Map lookups). All other rules enforced.

Formatter: 2-space indent, 100-char line width, double quotes, semicolons.

---

## Testing

**253 tests across 30 files** — all using Bun's built-in test runner with `:memory:` SQLite databases.

| File                              | Tests | Coverage                                     |
|-----------------------------------|-------|----------------------------------------------|
| `config.test.ts`                  | 8     | YAML config loading, Zod validation, env substitution |
| `context-builder.test.ts`         | 11    | Budget allocation, redistribution, check-ins  |
| `context-builder-vault.test.ts`   | 5     | Vault pass, budget, redistribution, null provider |
| `hybrid-search.test.ts`           | 5     | Keyword, semantic, recency scoring           |
| `message-splitter.test.ts`        | 8     | Chunking, Unicode, edge cases                |
| `safe-markdown.test.ts`           | 6     | MarkdownV2 escaping                          |
| `session-manager.test.ts`         | 5     | UUID generation, timeout, clear              |
| `proactive-scheduler.test.ts`     | 26    | isQuietHours, scheduler lifecycle, collectors |
| `gating-query.test.ts`            | 8     | Schema validation, mock engine, error fallback |
| `message-queue-lock.test.ts`      | 3     | queryLock mutex, sequential processing       |
| `message-queue-stress.test.ts`    | 4     | Concurrent load, error isolation             |
| `mcp-memory.test.ts`              | 18    | MCP tool logic: save/edit/delete memory, save/edit/close goal |
| `memory-repo.test.ts`             | 21    | Memory + Goal CRUD, editGoal, FTS5 re-index, soft delete |
| `vault-parser.test.ts`            | 12    | Frontmatter, title, wiki-links, edge cases   |
| `vault-chunker.test.ts`           | 8     | Header split, paragraph split, overlap       |
| `vault-repo.test.ts`              | 11    | Upsert, hash check, FTS, delete, stale chunks |
| `vault-indexer.test.ts`           | 7     | Scan, filter, incremental, include/exclude   |
| `check-ins.test.ts`               | 16    | CheckInRepo CRUD, quiet mode, ISO datetime   |
| `gemini-stt.test.ts`              | 6     | STT transcription, formats, error handling   |
| `elevenlabs-tts.test.ts`          | 5     | ElevenLabs TTS synthesis, config, errors     |
| `gemini-tts.test.ts`              | 5     | Gemini TTS synthesis, ffmpeg, errors         |
| `voice-handler.test.ts`           | 7     | Voice/audio handler registration, pipeline   |
| `callbacks.test.ts`               | 6     | Inline button callbacks (skip/listen TTS)    |
| `twilio-calls.test.ts`            | 5     | Twilio outbound calls, TwiML, voice mapping  |
| `code-task-repo.test.ts`          | 3     | CodeTaskRepository CRUD, ordering, limits    |
| `project-repo.test.ts`            | 11    | ProjectRepository CRUD, limits, status       |
| `squid-config.test.ts`            | 4     | Squid config generation from allowed domains |
| `ndjson-parser.test.ts`           | 9     | Claude stream-json event parser coverage     |
| `status.test.ts`                  | 5     | /status command: uptime, stats, errors       |
| `message-flow.test.ts`            | 5     | End-to-end: save, query, FTS, split          |

**Run:** `bun test`
**Full check:** `bun run check` (typecheck + lint)

---

## Scripts

| Script           | Command              | Purpose                                       |
|-----------------|----------------------|-----------------------------------------------|
| `docker-start.ts` | `bun run docker` / `bun run docker-start` | Refresh Claude credentials + `docker compose up -d --build` |
| `web-setup.ts`   | `bun run web-setup`  | Web setup panel on port 19380 (primary setup)  |
| `setup.ts`       | `bun run setup`      | Interactive terminal wizard (alternative)      |
| `doctor.ts`      | `bun run doctor`     | Run 12 base checks (14 with Code Agent)      |
| `re-embed.ts`    | `bun run scripts/re-embed.ts` | Backfill embeddings for memories/goals without vectors |
| `backup.ts`      | `bun run backup`     | Full backup: JSON export (memories, goals, stats) + SQLite copy |
| —                | `bun run check`      | Typecheck + lint in one command                |
| —                | `bun run lint`       | Biome lint only                                |
| —                | `bun run lint:fix`   | Biome lint with auto-fix                       |
| —                | `bun run typecheck`  | TypeScript type check (`tsc --noEmit`)         |

---

## Deployment

### Quick Start
```bash
curl -fsSL https://justdobot.com/install.sh | bash
```

### Local Development
```bash
bun run web-setup  # configure via browser
bun run dev        # hot-reload mode
```

### Production
```bash
bun run start
```

### Docker
```bash
bun run docker     # recommended: refresh credentials + docker compose up -d --build
# or manually:
bun run setup      # (or web-setup) generate .env + config.yaml
docker compose up -d
```

`Dockerfile` uses `oven/bun:latest`, includes Docker CLI + buildx plugin (for Code Agent),
installs dependencies, runs health checks every 30s via `src/healthcheck.ts`.

Container runtime specifics:
- `read_only: true` root filesystem (application code immutable)
- writable tmpfs: `/tmp`, `/home/botuser` (ephemeral, lost on restart)
- `HOME=/home/botuser` (Claude SDK state path)
- bind mount `./data:/app/data` (database, backups)
- bind mount `./workspace:/app/workspace` (bot's persistent working directory, shared with sandbox)
- vault mount `${VAULT_PATH}:/app/vault` (Obsidian, optional)
- `config.yaml` mounted read-only
- `secrets/` NOT mounted (credentials injected via env var → entrypoint → tmpfs)
- `/var/run/docker.sock` mounted (for Code Agent sandbox management)
- `group_add: [DOCKER_GID]` for Docker socket access (default 0 on macOS)
- `WORKSPACE_HOST_PATH`, `DATA_HOST_PATH` env vars for Docker-in-Docker volume mapping

Claude OAuth flow in Docker:
1. Host `docker-start.ts` saves credentials to `secrets/claude-credentials.json` (not mounted)
   and generates `secrets/.docker-env` with `CLAUDE_CREDENTIALS_B64` (base64-encoded)
2. `docker-entrypoint.sh` decodes env var → writes to `${HOME}/.claude/.credentials.json` (tmpfs)
   → unsets env var → execs bot (credentials not visible in volumes or env vars)
3. `ClaudeOAuthRefreshManager` refreshes access token via `fetch` before expiry
4. Refreshed credentials are atomically written to SDK path in tmpfs only
