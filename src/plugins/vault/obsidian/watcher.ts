import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { getLogger } from "../../../core/logger";

// ─── Types ──────────────────────────────────────────────────────

export interface WatcherConfig {
  mode: "poll" | "native";
  pollIntervalSeconds: number;
  vaultPath: string;
  include: string[];
  exclude: string[];
}

type FileCallback = (filePath: string) => Promise<void>;

// ─── Watcher ────────────────────────────────────────────────────

export class VaultWatcher {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private mtimeCache = new Map<string, number>();

  constructor(
    private config: WatcherConfig,
    private onFileChanged: FileCallback,
    private onFileDeleted: FileCallback,
  ) {}

  start(): void {
    const logger = getLogger();
    if (this.config.mode === "native") {
      this.startNativeMode();
      logger.info("Vault watcher started (native mode)");
    } else {
      this.startPollMode();
      logger.info(
        { intervalSec: this.config.pollIntervalSeconds },
        "Vault watcher started (poll mode)",
      );
    }
  }

  stop(): void {
    // Stop poll timer
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop native watchers
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    getLogger().info("Vault watcher stopped");
  }

  // ─── Poll Mode ──────────────────────────────────────────────

  private startPollMode(): void {
    // Build initial mtime cache
    this.pollScan().catch(() => {});

    this.pollTimer = setInterval(
      () => this.pollScan().catch(() => {}),
      this.config.pollIntervalSeconds * 1000,
    );
  }

  private async pollScan(): Promise<void> {
    const logger = getLogger();
    const currentFiles = new Set<string>();

    try {
      const files = await this.scanFiles();
      for (const filePath of files) {
        currentFiles.add(filePath);
        try {
          const s = await stat(filePath);
          const mtime = s.mtimeMs;
          const cached = this.mtimeCache.get(filePath);

          if (cached === undefined) {
            // First scan — just cache, no callback
            this.mtimeCache.set(filePath, mtime);
          } else if (mtime !== cached) {
            this.mtimeCache.set(filePath, mtime);
            logger.debug({ filePath }, "Vault file changed (poll)");
            await this.onFileChanged(filePath);
          }
        } catch {
          // File stat failed — skip
        }
      }

      // Detect deletions
      for (const cachedPath of this.mtimeCache.keys()) {
        if (!currentFiles.has(cachedPath)) {
          this.mtimeCache.delete(cachedPath);
          logger.debug({ filePath: cachedPath }, "Vault file deleted (poll)");
          await this.onFileDeleted(cachedPath);
        }
      }
    } catch (err) {
      logger.error({ err }, "Vault poll scan error");
    }
  }

  // ─── Native Mode ────────────────────────────────────────────

  private startNativeMode(): void {
    const logger = getLogger();

    try {
      const watcher = watch(this.config.vaultPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const fullPath = join(this.config.vaultPath, filename);

        if (!this.matchesPatterns(filename)) return;

        // Debounce 5 seconds per file
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          fullPath,
          setTimeout(async () => {
            this.debounceTimers.delete(fullPath);
            try {
              await stat(fullPath);
              logger.debug({ filePath: fullPath }, "Vault file changed (native)");
              await this.onFileChanged(fullPath);
            } catch {
              // File doesn't exist — was deleted
              logger.debug({ filePath: fullPath }, "Vault file deleted (native)");
              await this.onFileDeleted(fullPath);
            }
          }, 5000),
        );
      });
      this.watchers.push(watcher);
    } catch (err) {
      logger.error({ err }, "Failed to start native vault watcher");
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private async scanFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.walkDir(this.config.vaultPath, files);
    return files;
  }

  private async walkDir(dir: string, results: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(this.config.vaultPath, fullPath);

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (this.isExcluded(rel)) continue;
        await this.walkDir(fullPath, results);
      } else if (entry.isFile()) {
        if (this.matchesPatterns(rel)) {
          results.push(fullPath);
        }
      }
    }
  }

  private matchesPatterns(relativePath: string): boolean {
    const ext = extname(relativePath).toLowerCase();
    if (ext !== ".md" && ext !== ".pdf") return false;
    if (this.isExcluded(relativePath)) return false;
    return this.isIncluded(relativePath);
  }

  private isIncluded(relativePath: string): boolean {
    if (this.config.include.length === 0) return true;
    return this.config.include.some((pattern) => relativePath.startsWith(pattern));
  }

  private isExcluded(relativePath: string): boolean {
    const segments = relativePath.split("/");
    return this.config.exclude.some((pattern) => segments.includes(pattern));
  }
}
