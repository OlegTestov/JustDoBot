import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import type {
  Goal,
  HealthStatus,
  HybridSearchResult,
  IMemoryProvider,
  Memory,
  Message,
  PluginConfig,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";
import { CheckInRepository } from "./check-ins";
import { CodeTaskRepository } from "./code-tasks";
import { GoalRepository } from "./goals";
import { MemoryRepository } from "./memories";
import { MessageRepository } from "./messages";
import { ProjectRepository } from "./projects";
import { STAGE1_DDL } from "./schema";
import { STAGE2_DDL_CORE, stage2VecDDL } from "./schema-stage2";
import { STAGE3_DDL_CORE, stage3VecDDL } from "./schema-stage3";
import { migrateCheckInLogsAddCall, STAGE4_DDL_CORE } from "./schema-stage4";
import { STAGE6_DDL_CORE } from "./schema-stage6";
import { VaultRepository } from "./vault";
import { VectorRepository } from "./vectors";

export class SqliteMemoryProvider implements IMemoryProvider {
  name = "sqlite";
  version = "3.0.0";
  private db!: Database;
  private repo!: MessageRepository;
  private memoryRepo!: MemoryRepository;
  private goalRepo!: GoalRepository;
  private vaultRepo!: VaultRepository;
  private vecRepo!: VectorRepository;
  private checkInRepo!: CheckInRepository;
  private projectRepo!: ProjectRepository;
  private codeTaskRepo!: CodeTaskRepository;

  async init(config: PluginConfig, embeddingDimensions = 768): Promise<void> {
    const cfg = config as { database: { path: string } };
    const dbPath = cfg.database.path;

    await mkdir(dirname(dbPath), { recursive: true });

    // On macOS, try Homebrew SQLite for extension support (must be set BEFORE creating Database)
    SqliteMemoryProvider.ensureCustomSQLite();

    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    // Stage 1 schema
    this.db.exec(STAGE1_DDL);

    // Verify FTS5 works
    try {
      this.db.exec("SELECT 1 FROM fts_messages LIMIT 0");
    } catch {
      throw new Error(
        "FTS5 extension not available in this SQLite build. " +
          "Bun's built-in SQLite should support FTS5 — check your Bun version.",
      );
    }

    // Stage 2 schema
    this.db.exec(STAGE2_DDL_CORE);

    // sqlite-vec (optional) — load extension into database
    try {
      sqliteVec.load(this.db);
    } catch {
      getLogger().info(
        "sqlite-vec not available — vector search disabled, using FTS5 + recency only",
      );
    }
    this.vecRepo = new VectorRepository(this.db);
    if (this.vecRepo.isAvailable) {
      this.migrateVecDimensions(embeddingDimensions);
    }

    // Stage 3 schema
    this.db.exec(STAGE3_DDL_CORE);
    if (this.vecRepo.isAvailable) {
      this.db.exec(stage3VecDDL(embeddingDimensions));
    }

    // Stage 4 schema
    this.db.exec(STAGE4_DDL_CORE);
    migrateCheckInLogsAddCall(this.db);

    // Stage 6 schema
    this.db.exec(STAGE6_DDL_CORE);

    // Init repositories
    this.repo = new MessageRepository(this.db);
    this.memoryRepo = new MemoryRepository(this.db);
    this.goalRepo = new GoalRepository(this.db);
    this.vaultRepo = new VaultRepository(this.db);
    this.checkInRepo = new CheckInRepository(this.db);
    this.projectRepo = new ProjectRepository(this.db);
    this.codeTaskRepo = new CodeTaskRepository(this.db);

    getLogger().info({ path: dbPath }, "SQLite database initialized (Stage 6)");
  }

  /** Migrate vector tables when embedding dimensions change (e.g. 1536 → 768). */
  private migrateVecDimensions(dimensions: number): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS bot_metadata (key TEXT PRIMARY KEY, value TEXT)");

    const row = this.db
      .prepare("SELECT value FROM bot_metadata WHERE key = 'embedding_dimensions'")
      .get() as { value: string } | null;

    const storedDims = row ? Number.parseInt(row.value, 10) : null;

    if (storedDims === dimensions) {
      // Dimensions match — just create tables if they don't exist yet
      this.db.exec(stage2VecDDL(dimensions));
      return;
    }

    // Dimensions changed (or first run with existing tables) — drop and recreate
    getLogger().info(
      { from: storedDims, to: dimensions },
      "Embedding dimensions changed — recreating vector tables",
    );
    this.db.exec("DROP TABLE IF EXISTS vec_memories");
    this.db.exec("DROP TABLE IF EXISTS vec_goals");
    this.db.exec("DROP TABLE IF EXISTS vec_vault");

    this.db.exec(stage2VecDDL(dimensions));
    this.db
      .prepare(
        "INSERT OR REPLACE INTO bot_metadata (key, value) VALUES ('embedding_dimensions', $dims)",
      )
      .run({ $dims: String(dimensions) });
  }

  private static customSQLiteSet = false;

  /** Try to use SQLite with loadExtension support on macOS. Must be called BEFORE new Database(). */
  private static ensureCustomSQLite(): void {
    if (SqliteMemoryProvider.customSQLiteSet) return;
    if (process.platform !== "darwin") return;

    // Project root = 4 levels up from src/plugins/database/sqlite/
    const projectRoot = join(dirname(new URL(import.meta.url).pathname), "../../../..");

    const sqlitePaths = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon (Homebrew)
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel Mac (Homebrew)
      join(projectRoot, "lib", "libsqlite3.dylib"), // Bundled fallback (universal binary)
    ];
    for (const libPath of sqlitePaths) {
      if (!existsSync(libPath)) continue;
      try {
        Database.setCustomSQLite(libPath);
        SqliteMemoryProvider.customSQLiteSet = true;
        return;
      } catch {
        // Incompatible — try next
      }
    }
  }

  async destroy(): Promise<void> {
    await this.flush();
    this.db.close();
  }

  async flush(): Promise<void> {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      this.db.exec("SELECT 1");
      return { healthy: true, lastCheck: new Date() };
    } catch (err) {
      return { healthy: false, message: String(err), lastCheck: new Date() };
    }
  }

  // ─── Stage 1: Messages ──────────────────────────────────────────

  async saveMessage(msg: Message): Promise<void> {
    this.repo.saveMessage(msg);
  }

  async getRecentMessages(limit: number, sessionId?: string): Promise<Message[]> {
    if (!sessionId) return [];
    return this.repo.getRecentMessages(limit, sessionId);
  }

  async getLastMessageTime(sessionId: string): Promise<string | null> {
    return this.repo.getLastMessageTime(sessionId);
  }

  // ─── Stage 2: Memories ──────────────────────────────────────────

  async saveMemory(memory: Memory): Promise<number> {
    return this.memoryRepo.saveMemory(memory);
  }

  async getMemories(options: { active?: boolean; limit?: number }): Promise<Memory[]> {
    return this.memoryRepo.getMemories(options);
  }

  async checkExactDuplicate(content: string): Promise<Memory | null> {
    return this.memoryRepo.checkExactDuplicate(content);
  }

  async updateMemory(id: number, updates: Partial<Memory>): Promise<void> {
    this.memoryRepo.updateMemory(id, updates);
  }

  async deleteMemory(id: number): Promise<void> {
    this.memoryRepo.deleteMemory(id);
  }

  // ─── Stage 2: Goals ─────────────────────────────────────────────

  async saveGoal(goal: Omit<Goal, "id" | "created_at" | "updated_at">): Promise<number> {
    return this.goalRepo.saveGoal(goal);
  }

  async getActiveGoals(): Promise<Goal[]> {
    return this.goalRepo.getActiveGoals();
  }

  async getGoal(id: number): Promise<Goal | null> {
    return this.goalRepo.getGoalById(id);
  }

  async updateGoal(id: number, action: string, note?: string): Promise<void> {
    this.goalRepo.updateGoal(id, action, note);
  }

  async editGoal(
    id: number,
    updates: { title?: string; description?: string; deadline?: string | null },
    note?: string,
  ): Promise<Goal | null> {
    return this.goalRepo.editGoal(id, updates, note);
  }

  async searchGoalsByTitle(title: string): Promise<Goal[]> {
    return this.goalRepo.searchGoalsByTitleFTS(title);
  }

  // ─── Stage 2: Vectors ──────────────────────────────────────────

  async saveVecMemory(memoryId: number, embedding: number[]): Promise<void> {
    this.vecRepo.saveVecMemory(memoryId, embedding);
  }

  async saveVecGoal(goalId: number, embedding: number[]): Promise<void> {
    this.vecRepo.saveVecGoal(goalId, embedding);
  }

  async searchSemanticMemories(
    embedding: number[],
    limit: number,
  ): Promise<Array<{ id: number; distance: number }>> {
    return this.vecRepo.searchMemories(embedding, limit);
  }

  async searchSemanticGoals(
    embedding: number[],
    limit: number,
  ): Promise<Array<{ id: number; distance: number }>> {
    return this.vecRepo.searchGoals(embedding, limit);
  }

  // ─── Stage 2: Hybrid Search ─────────────────────────────────────

  async searchMemoriesHybrid(
    query: string,
    _embedding: number[] | null,
    limit: number,
  ): Promise<HybridSearchResult[]> {
    // FTS5 keyword search — semantic part handled by hybrid-search.ts
    const ftsResults = this.memoryRepo.searchMemoriesFTS(query, limit);
    return ftsResults.map((m) => ({
      id: m.id!,
      content: m.content,
      score: 0, // Score will be computed by hybrid-search.ts
      source: "memory" as const,
    }));
  }

  // ─── Stage 3: Vault ────────────────────────────────────────────

  async saveVecVault(docId: number, embedding: number[]): Promise<void> {
    this.vecRepo.saveVecVault(docId, embedding);
  }

  async searchSemanticVault(
    embedding: number[],
    limit: number,
  ): Promise<Array<{ id: number; distance: number }>> {
    return this.vecRepo.searchVault(embedding, limit);
  }

  async searchVaultFTS(
    query: string,
    limit: number,
  ): Promise<import("../../../core/interfaces").VaultDocument[]> {
    return this.vaultRepo.searchFTS(query, limit);
  }

  // ─── Expose internals for MCP server / vault ──────────────────

  getMemoryRepo(): MemoryRepository {
    return this.memoryRepo;
  }
  getGoalRepo(): GoalRepository {
    return this.goalRepo;
  }
  getVecRepo(): VectorRepository {
    return this.vecRepo;
  }
  getVaultRepo(): VaultRepository {
    return this.vaultRepo;
  }
  getDatabase(): Database {
    return this.db;
  }

  // ─── Stage 4: Check-ins ───────────────────────────────────────

  getCheckInRepo(): CheckInRepository {
    return this.checkInRepo;
  }

  // ─── Stage 6: Code Agent ──────────────────────────────────────

  getProjectRepo(): ProjectRepository {
    return this.projectRepo;
  }

  getCodeTaskRepo(): CodeTaskRepository {
    return this.codeTaskRepo;
  }

  async getRecentVaultDocuments(
    since: string,
    limit: number,
  ): Promise<Array<{ title: string; file_path: string; indexed_at: string }>> {
    const stmt = this.db.prepare(`
      SELECT DISTINCT file_path, title, MAX(indexed_at) as indexed_at
      FROM vault_documents
      WHERE indexed_at > ?
      GROUP BY file_path
      ORDER BY indexed_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(since, limit) as Array<{
      file_path: string;
      title: string | null;
      indexed_at: string;
    }>;
    return rows.map((r) => ({
      title: r.title ?? r.file_path.split("/").pop() ?? "Untitled",
      file_path: r.file_path,
      indexed_at: r.indexed_at,
    }));
  }
}
