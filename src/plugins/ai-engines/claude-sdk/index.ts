import {
  AbortError,
  type McpServerConfig,
  query,
  type SDKAssistantMessage,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AssembledContext,
  HealthStatus,
  IAIEngine,
  PluginConfig,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export function extractTextFromAssistant(msg: SDKAssistantMessage): string {
  return (msg.message.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

export class ClaudeSdkEngine implements IAIEngine {
  name = "claude-sdk";
  version = "1.0.0";
  private abortController: AbortController | null = null;
  private config!: {
    model: string;
    max_turns: number;
    allowed_tools: string[];
    timeout_seconds: number;
    streaming: boolean;
  };
  private botName!: string;

  async init(config: PluginConfig): Promise<void> {
    type EngineConfig = {
      model: string;
      max_turns: number;
      allowed_tools: string[];
      timeout_seconds: number;
      streaming: boolean;
    };
    const cfg = config as {
      ai_engine: EngineConfig;
      bot: { name: string };
    };
    this.config = {
      ...cfg.ai_engine,
    };
    this.botName = cfg.bot.name;
    getLogger().info("Claude SDK engine initialized");
  }

  async *queryStream(
    prompt: string,
    _context: AssembledContext,
    options?: {
      abortController?: AbortController;
      systemPrompt?: string;
      mcpServers?: Record<string, McpServerConfig>;
    },
  ): AsyncGenerator<SDKMessage, void> {
    const logger = getLogger();
    this.abortController = options?.abortController ?? new AbortController();

    const timeoutId = setTimeout(
      () => this.abortController?.abort(),
      this.config.timeout_seconds * 1000,
    );

    const systemPrompt =
      options?.systemPrompt ?? `You are ${this.botName}, a personal AI assistant.`;

    try {
      const generator = query({
        prompt,
        options: {
          model: this.config.model,
          systemPrompt,
          allowedTools: this.config.allowed_tools,
          maxTurns: this.config.max_turns,
          includePartialMessages: this.config.streaming,
          abortController: this.abortController,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          ...(options?.mcpServers ? { mcpServers: options.mcpServers } : {}),
        },
      });

      for await (const message of generator) {
        yield message;
      }
    } catch (error) {
      if (error instanceof AbortError) {
        logger.info("Query aborted");
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }

  async queryStructured<T>(prompt: string, jsonSchema: Record<string, unknown>): Promise<T> {
    let fullText = "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout_seconds * 1000);

    // Embed schema in prompt instead of using outputFormat (which hangs in Docker/subprocess)
    const jsonPrompt = `${prompt}

IMPORTANT: Respond with ONLY a valid JSON object matching this schema, no markdown fences, no extra text:
${JSON.stringify(jsonSchema, null, 2)}`;

    try {
      const gen = query({
        prompt: jsonPrompt,
        options: {
          model: this.config.model,
          maxTurns: 1,
          systemPrompt:
            "You are a JSON-only responder. Output raw JSON matching the requested schema. No markdown, no explanation.",
          abortController: controller,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        },
      });

      for await (const msg of gen) {
        if (msg.type === "assistant") {
          const content = (msg as SDKAssistantMessage).message.content;
          fullText = (content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
        }
      }
    } catch (error) {
      if (error instanceof AbortError) {
        throw new Error("Structured query timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    // Strip markdown fences if model wraps response
    const cleaned = fullText
      .replace(/^```(?:json)?\s*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();
    return JSON.parse(cleaned) as T;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async destroy(): Promise<void> {
    this.abort();
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, lastCheck: new Date() };
  }
}
