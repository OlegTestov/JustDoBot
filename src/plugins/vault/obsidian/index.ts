import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  HealthStatus,
  IEmbeddingProvider,
  IVaultProvider,
  PluginConfig,
  VaultSearchResult,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";
import type { SqliteMemoryProvider } from "../../database/sqlite/index";
import type { VaultRepository } from "../../database/sqlite/vault";
import type { VectorRepository } from "../../database/sqlite/vectors";
import { VaultIndexer } from "./indexer";
import { VaultWatcher } from "./watcher";

// ─── Types ──────────────────────────────────────────────────────

interface VaultDeps {
  database: SqliteMemoryProvider;
  embeddingProvider: IEmbeddingProvider | null;
}

// ─── Provider ───────────────────────────────────────────────────

export class ObsidianVaultProvider implements IVaultProvider {
  name = "obsidian-vault";
  version = "1.0.0";

  private indexer!: VaultIndexer;
  private watcher!: VaultWatcher;
  private vaultRepo!: VaultRepository;
  private vecRepo!: VectorRepository;
  private database!: SqliteMemoryProvider;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private vaultPath = "";

  setDeps(deps: VaultDeps): void {
    this.database = deps.database;
    this.embeddingProvider = deps.embeddingProvider;
  }

  async init(config: PluginConfig): Promise<void> {
    // Resolve repos here (after database.init() has run)
    this.vaultRepo = this.database.getVaultRepo();
    this.vecRepo = this.database.getVecRepo();

    const cfg = config as {
      vault: {
        path: string;
        include: string[];
        exclude: string[];
        watch_mode: "poll" | "native";
        poll_interval_seconds: number;
      };
    };

    this.vaultPath = cfg.vault.path;

    if (!this.vaultPath || !existsSync(this.vaultPath)) {
      throw new Error(
        `Vault path does not exist: "${this.vaultPath}". ` +
          `Set VAULT_PATH env variable or update vault.path in config.yaml`,
      );
    }

    this.indexer = new VaultIndexer(
      {
        vaultPath: this.vaultPath,
        include: cfg.vault.include,
        exclude: cfg.vault.exclude,
      },
      {
        vaultRepo: this.vaultRepo,
        vecRepo: this.vecRepo,
        embeddingProvider: this.embeddingProvider,
      },
    );

    this.watcher = new VaultWatcher(
      {
        mode: cfg.vault.watch_mode,
        pollIntervalSeconds: cfg.vault.poll_interval_seconds,
        vaultPath: this.vaultPath,
        include: cfg.vault.include,
        exclude: cfg.vault.exclude,
      },
      async (filePath) => {
        try {
          await this.indexer.indexFile(filePath);
        } catch (err) {
          getLogger().warn({ err, filePath }, "Watcher: failed to reindex file");
        }
      },
      async (filePath) => {
        try {
          await this.indexer.removeFile(filePath);
        } catch (err) {
          getLogger().warn({ err, filePath }, "Watcher: failed to remove file");
        }
      },
    );

    getLogger().info({ vaultPath: this.vaultPath }, "Obsidian vault provider initialized");
  }

  async index(): Promise<number> {
    return this.indexer.indexAll();
  }

  async search(
    query: string,
    embedding: number[] | null,
    limit: number,
  ): Promise<VaultSearchResult[]> {
    const hasSemantic = embedding !== null;

    // Weights
    const w = hasSemantic
      ? { semantic: 0.4, keyword: 0.4, recency: 0.2 }
      : { semantic: 0, keyword: 0.67, recency: 0.33 };

    // 1. FTS5 keyword search
    const ftsResults = this.vaultRepo.searchFTS(query, limit * 2);

    // 2. Semantic search
    let semanticHits: Array<{ id: number; distance: number }> = [];
    if (hasSemantic) {
      semanticHits = this.vecRepo.searchVault(embedding!, limit * 2);
    }

    // 3. Merge into score map
    const scoreMap = new Map<
      number,
      {
        id: number;
        file_path: string;
        title: string | null;
        content: string;
        chunk_index: number;
        keyword: number;
        semantic: number;
        recency: number;
        indexed_at?: string;
      }
    >();

    // Keyword scoring: position-based
    const ftsCount = ftsResults.length;
    for (let i = 0; i < ftsCount; i++) {
      const doc = ftsResults[i];
      if (!scoreMap.has(doc.id!)) {
        scoreMap.set(doc.id!, {
          id: doc.id!,
          file_path: doc.file_path,
          title: doc.title,
          content: doc.content,
          chunk_index: doc.chunk_index,
          keyword: 0,
          semantic: 0,
          recency: 0,
          indexed_at: doc.indexed_at,
        });
      }
      scoreMap.get(doc.id!)!.keyword = ftsCount === 1 ? 1.0 : 1.0 - i / (ftsCount - 1);
    }

    // Semantic scoring: distance → similarity
    for (const hit of semanticHits) {
      if (!scoreMap.has(hit.id)) {
        // Fetch full document
        const doc = this.vaultRepo.getById(hit.id);
        if (!doc) continue;
        scoreMap.set(hit.id, {
          id: hit.id,
          file_path: doc.file_path,
          title: doc.title,
          content: doc.content,
          chunk_index: doc.chunk_index,
          keyword: 0,
          semantic: 0,
          recency: 0,
          indexed_at: doc.indexed_at,
        });
      }
      scoreMap.get(hit.id)!.semantic = Math.max(0, 1.0 - hit.distance);
    }

    // 4. Recency scoring
    const now = Date.now();
    for (const entry of scoreMap.values()) {
      if (entry.indexed_at) {
        const ageMs = now - new Date(entry.indexed_at).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        entry.recency = 1.0 / (1.0 + ageDays / 30.0);
      }
    }

    // 5. Final scores
    const results: VaultSearchResult[] = [];
    for (const entry of scoreMap.values()) {
      const score =
        w.semantic * entry.semantic + w.keyword * entry.keyword + w.recency * entry.recency;
      results.push({
        id: entry.id,
        file_path: entry.file_path,
        title: entry.title,
        content: entry.content,
        chunk_index: entry.chunk_index,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async getDocumentCount(): Promise<number> {
    return this.vaultRepo.getDocumentCount();
  }

  async writeNote(relativePath: string, content: string): Promise<void> {
    const fullPath = join(this.vaultPath, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    getLogger().info({ path: relativePath }, "Vault note created");
  }

  startWatching(): void {
    this.watcher.start();
  }

  stopWatching(): void {
    this.watcher.stop();
  }

  async destroy(): Promise<void> {
    this.stopWatching();
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const pathExists = existsSync(this.vaultPath);
      const count = this.vaultRepo.getDocumentCount();
      return {
        healthy: pathExists,
        message: pathExists
          ? `Vault: ${count} chunks indexed`
          : `Vault path not found: ${this.vaultPath}`,
        lastCheck: new Date(),
      };
    } catch (err) {
      return { healthy: false, message: String(err), lastCheck: new Date() };
    }
  }
}
