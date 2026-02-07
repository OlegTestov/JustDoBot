#!/usr/bin/env bun
/**
 * Re-embed script — backfill embeddings for memories/goals that don't have vectors yet.
 *
 * Usage:
 *   bun run scripts/re-embed.ts
 *   bun run scripts/re-embed.ts --dry-run
 *
 * Requires: OPENAI_API_KEY in .env and embedding.enabled: true in config.
 */

import { parseArgs } from "node:util";
import { loadConfig } from "../src/config";
import { SqliteMemoryProvider } from "../src/plugins/database/sqlite/index";
import { OpenAIEmbeddingProvider } from "../src/plugins/embeddings/openai/index";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
  },
});

const dryRun = values["dry-run"] ?? false;

async function main() {
  const config = loadConfig();

  if (!config.embedding.enabled) {
    console.log("Embedding is disabled in config. Enable it first.");
    process.exit(1);
  }

  // Init database
  const db = new SqliteMemoryProvider();
  await db.init({ database: config.database } as Record<string, unknown>);

  // Init embedding provider
  const embedder = new OpenAIEmbeddingProvider();
  await embedder.init({ embedding: config.embedding } as Record<string, unknown>);

  const vecRepo = db.getVecRepo();
  if (!vecRepo.isAvailable) {
    console.log(
      "sqlite-vec not available. Vector tables cannot be populated. " +
        "Hybrid search will use FTS5 + recency only.",
    );
    await db.destroy();
    process.exit(0);
  }

  // ── Memories ──
  const memories = await db.getMemories({ active: true, limit: 10000 });
  console.log(`Found ${memories.length} active memories`);

  let memEmbedded = 0;
  let memSkipped = 0;

  // Batch embed for efficiency
  const BATCH_SIZE = 100;
  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);
    const textsToEmbed: Array<{ id: number; text: string }> = [];

    for (const mem of batch) {
      if (!mem.id) continue;
      // Check if already has embedding
      const existing = await db.searchSemanticMemories!(
        new Array(embedder.dimensions).fill(0),
        10000,
      );
      const hasVec = existing.some((e) => e.id === mem.id);
      if (hasVec) {
        memSkipped++;
        continue;
      }
      textsToEmbed.push({ id: mem.id, text: mem.content });
    }

    if (textsToEmbed.length === 0) continue;

    if (dryRun) {
      console.log(`  [dry-run] Would embed ${textsToEmbed.length} memories`);
      memEmbedded += textsToEmbed.length;
      continue;
    }

    const embeddings = await embedder.embedBatch(textsToEmbed.map((t) => t.text));

    for (let j = 0; j < textsToEmbed.length; j++) {
      await db.saveVecMemory!(textsToEmbed[j].id, embeddings[j]);
      memEmbedded++;
    }

    console.log(
      `  Embedded memories batch ${Math.floor(i / BATCH_SIZE) + 1}: ${textsToEmbed.length} items`,
    );
  }

  console.log(`Memories: ${memEmbedded} embedded, ${memSkipped} skipped (already had vectors)`);

  // ── Goals ──
  const goals = await db.getActiveGoals();
  console.log(`Found ${goals.length} active goals`);

  let goalEmbedded = 0;

  for (const goal of goals) {
    if (!goal.id) continue;

    const text = `${goal.title} ${goal.description ?? ""}`.trim();

    if (dryRun) {
      console.log(`  [dry-run] Would embed goal #${goal.id}: ${goal.title}`);
      goalEmbedded++;
      continue;
    }

    try {
      const embedding = await embedder.embed(text);
      await db.saveVecGoal!(goal.id, embedding);
      goalEmbedded++;
      console.log(`  Embedded goal #${goal.id}: ${goal.title}`);
    } catch (err) {
      console.error(`  Failed to embed goal #${goal.id}:`, err);
    }
  }

  console.log(`Goals: ${goalEmbedded} embedded`);

  await db.destroy();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Re-embed failed:", err);
  process.exit(1);
});
