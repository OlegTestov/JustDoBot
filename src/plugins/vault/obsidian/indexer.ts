import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { IEmbeddingProvider, VaultDocument } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";
import type { VaultRepository } from "../../database/sqlite/vault";
import type { VectorRepository } from "../../database/sqlite/vectors";
import { chunkDocument } from "./chunker";
import { parseMarkdown, parsePDF, resolveWikiLinks } from "./parser";

// ─── Types ──────────────────────────────────────────────────────

export interface IndexerConfig {
  vaultPath: string;
  include: string[];
  exclude: string[];
}

export interface IndexerDeps {
  vaultRepo: VaultRepository;
  vecRepo: VectorRepository;
  embeddingProvider: IEmbeddingProvider | null;
}

// ─── Indexer ────────────────────────────────────────────────────

export class VaultIndexer {
  constructor(
    private config: IndexerConfig,
    private deps: IndexerDeps,
  ) {}

  /** Full index of all vault files. Returns total number of chunks indexed. */
  async indexAll(): Promise<number> {
    const logger = getLogger();
    const files = await this.scanFiles();
    logger.info({ fileCount: files.length }, "Vault scan complete");

    let totalChunks = 0;
    for (const filePath of files) {
      try {
        const chunks = await this.indexFile(filePath);
        totalChunks += chunks;
      } catch (err) {
        logger.warn({ err, filePath }, "Failed to index vault file");
      }
    }

    logger.info({ totalChunks }, "Vault indexing complete");
    return totalChunks;
  }

  /** Index a single file. Returns number of chunks created. */
  async indexFile(filePath: string): Promise<number> {
    const logger = getLogger();
    const relativePath = relative(this.config.vaultPath, filePath);

    // Read file content
    const ext = extname(filePath).toLowerCase();
    let raw: string;
    let parsed: ReturnType<typeof parseMarkdown>;

    if (ext === ".pdf") {
      const buffer = Buffer.from(await readFile(filePath));
      parsed = await parsePDF(buffer, filePath);
      raw = parsed.content;
    } else {
      raw = await readFile(filePath, "utf-8");
      parsed = parseMarkdown(raw, filePath);
    }

    // Compute hash of content
    const contentHash = this.computeHash(raw);

    // Check if unchanged
    const existingHash = this.deps.vaultRepo.getHashByPath(relativePath);
    if (existingHash === contentHash) {
      return 0; // Unchanged — skip
    }

    // Resolve wiki-links in content for better searchability
    const resolvedContent = resolveWikiLinks(parsed.content);

    // Chunk the document
    const chunks = chunkDocument(resolvedContent);

    // Get existing doc IDs for vector cleanup
    const existingDocs = this.deps.vaultRepo.getDocumentsByPath(relativePath);
    const existingDocIds = existingDocs.map((d) => d.id!);

    // Delete old vectors for this file
    for (const docId of existingDocIds) {
      this.deps.vecRepo.deleteVecVault(docId);
    }

    // Upsert each chunk
    const docIds: number[] = [];
    const chunkTexts: string[] = [];

    for (const chunk of chunks) {
      const doc: VaultDocument = {
        file_path: relativePath,
        chunk_index: chunk.index,
        title: parsed.title,
        content: chunk.content,
        content_hash: contentHash,
        metadata: JSON.stringify({
          frontmatter: parsed.frontmatter,
          wikiLinks: parsed.wikiLinks,
          headerPath: chunk.headerPath,
        }),
      };

      const id = this.deps.vaultRepo.upsertDocument(doc);
      docIds.push(id);
      chunkTexts.push(chunk.content);
    }

    // Delete stale chunks (if file shrank)
    if (chunks.length > 0) {
      this.deps.vaultRepo.deleteStaleChunks(relativePath, chunks[chunks.length - 1].index);
    }

    // Generate embeddings in batch
    if (this.deps.embeddingProvider && chunkTexts.length > 0) {
      // Filter valid texts (non-empty, within token limit ~30k chars ≈ 8k tokens)
      const MAX_EMBED_CHARS = 30_000;
      const validIndices: number[] = [];
      const validTexts: string[] = [];
      for (let i = 0; i < chunkTexts.length; i++) {
        const text = chunkTexts[i].replace(/\0/g, "").trim();
        if (text.length > 0 && text.length <= MAX_EMBED_CHARS) {
          validIndices.push(i);
          validTexts.push(text);
        }
      }

      if (validTexts.length > 0) {
        try {
          const embeddings = await this.deps.embeddingProvider.embedBatch(validTexts);
          for (let j = 0; j < validIndices.length; j++) {
            this.deps.vecRepo.saveVecVault(docIds[validIndices[j]], embeddings[j]);
          }
        } catch (err) {
          logger.warn({ err, filePath: relativePath }, "Failed to generate vault embeddings");
        }
      }
    }

    logger.debug({ filePath: relativePath, chunks: chunks.length }, "Indexed vault file");
    return chunks.length;
  }

  /** Remove a file from the index. */
  async removeFile(filePath: string): Promise<void> {
    const relativePath = relative(this.config.vaultPath, filePath);

    // Delete vectors first
    const docs = this.deps.vaultRepo.getDocumentsByPath(relativePath);
    for (const doc of docs) {
      this.deps.vecRepo.deleteVecVault(doc.id!);
    }

    // Delete document rows
    this.deps.vaultRepo.deleteByPath(relativePath);

    getLogger().debug({ filePath: relativePath }, "Removed vault file from index");
  }

  // ─── Private ──────────────────────────────────────────────────

  async scanFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.walkDir(this.config.vaultPath, files);
    return files;
  }

  private async walkDir(dir: string, results: string[]): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Directory inaccessible (e.g., iCloud offloaded)
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(this.config.vaultPath, fullPath);

      if (entry.isDirectory()) {
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
    if (segments.some((s) => s.startsWith("."))) return true;
    return this.config.exclude.some((pattern) => segments.includes(pattern));
  }

  private computeHash(content: string): string {
    return createHash("md5").update(content).digest("hex");
  }
}
