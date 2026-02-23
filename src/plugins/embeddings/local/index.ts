import { AutoModel, AutoTokenizer } from "@huggingface/transformers";
import type { HealthStatus, IEmbeddingProvider, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";
const DEFAULT_CACHE_DIR = "./data/models";

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  name = "local-embeddings";
  version = "1.0.0";
  dimensions = 768;
  private model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null = null;
  private tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as { embedding?: { cache_dir?: string } };
    const cacheDir = cfg.embedding?.cache_dir ?? DEFAULT_CACHE_DIR;

    const start = Date.now();
    getLogger().info({ modelId: MODEL_ID, cacheDir }, "Loading embedding model...");

    this.tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      cache_dir: cacheDir,
    });
    this.model = await AutoModel.from_pretrained(MODEL_ID, {
      dtype: "q4" as never,
      cache_dir: cacheDir,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    getLogger().info(
      { dimensions: this.dimensions, elapsed: `${elapsed}s` },
      "Local embedding provider initialized",
    );
  }

  async embed(text: string, purpose: "query" | "document" = "document"): Promise<number[]> {
    const prefixed =
      purpose === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`;

    const inputs = await this.tokenizer!([prefixed], { padding: true });
    const output = await this.model!(inputs);
    return Array.from(output.sentence_embedding.data as Float32Array);
  }

  async embedBatch(
    texts: string[],
    purpose: "query" | "document" = "document",
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const prefixed = texts.map((t) =>
      purpose === "query" ? `task: search result | query: ${t}` : `title: none | text: ${t}`,
    );

    const inputs = await this.tokenizer!(prefixed, { padding: true });
    const output = await this.model!(inputs);
    const data = output.sentence_embedding.data as Float32Array;

    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(Array.from(data.slice(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return result;
  }

  async destroy(): Promise<void> {
    this.model = null;
    this.tokenizer = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: this.model !== null,
      lastCheck: new Date(),
      message: this.model ? undefined : "Model not loaded",
    };
  }
}
