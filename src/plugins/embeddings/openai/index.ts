import type { HealthStatus, IEmbeddingProvider, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  name = "openai-embeddings";
  version = "1.0.0";
  dimensions = 1536;
  private apiKey = "";
  private model = "text-embedding-3-small";

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as {
      embedding: { model: string; dimensions: number };
    };
    this.model = cfg.embedding.model;
    this.dimensions = cfg.embedding.dimensions;
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Required when embedding.enabled: true. " +
          "Add it to .env or disable embeddings in config.yaml.",
      );
    }
    getLogger().info(
      { model: this.model, dimensions: this.dimensions },
      "OpenAI embedding provider initialized",
    );
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding API error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to preserve order
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: !!this.apiKey,
      lastCheck: new Date(),
      message: this.apiKey ? undefined : "No API key configured",
    };
  }
}
