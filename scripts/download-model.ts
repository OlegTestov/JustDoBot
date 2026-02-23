#!/usr/bin/env bun
/**
 * Pre-download the embedding model so first bot start is instant.
 *
 * Usage:
 *   bun run download-model
 *   bun run scripts/download-model.ts
 */
import { AutoModel, AutoTokenizer } from "@huggingface/transformers";

const modelId = "onnx-community/embeddinggemma-300m-ONNX";
const cacheDir = "./data/models";

console.log(`Downloading embedding model (~200 MB)...`);
console.log(`  Model: ${modelId}`);
console.log(`  Cache: ${cacheDir}`);

const start = Date.now();

await AutoTokenizer.from_pretrained(modelId, { cache_dir: cacheDir });
await AutoModel.from_pretrained(modelId, {
  dtype: "q4" as never,
  cache_dir: cacheDir,
});

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s.`);
