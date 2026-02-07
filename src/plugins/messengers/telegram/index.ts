import { Bot } from "grammy";
import type {
  HealthStatus,
  IAIEngine,
  IMessenger,
  MessageHandler,
  PluginConfig,
  SendOptions,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";
import type { SessionManager } from "../../../core/session-manager";
import type { Translator } from "../../../locales";
import { registerCallbackHandler } from "./handlers/callbacks";
import { registerCommands } from "./handlers/commands";
import { registerMediaHandler } from "./handlers/media";
import { registerTextHandler } from "./handlers/text";
import { registerVoiceHandler } from "./handlers/voice";
import { createAuthMiddleware } from "./middleware/auth";
import { createLoggingMiddleware } from "./middleware/logging";
import { createRateLimitMiddleware } from "./middleware/rate-limit";

export interface TelegramDeps {
  sessionManager: SessionManager;
  aiEngine: IAIEngine;
  botName: string;
  t: Translator;
  database?: import("../../../core/interfaces").IMemoryProvider;
  vaultProvider?: import("../../../core/interfaces").IVaultProvider;
  embeddingProvider?: import("../../../core/interfaces").IEmbeddingProvider;
  sttProvider?: import("../../../core/interfaces").ISTTProvider;
  ttsProvider?: import("../../../core/interfaces").ITTSProvider;
  registry?: import("../../../registry").PluginRegistry;
  checkInRepo?: import("../../database/sqlite/check-ins").CheckInRepository;
  codeExecutor?: import("../../../core/interfaces").ICodeExecutor;
  codeExecutorError?: string;
  timezone: string;
}

export class TelegramMessenger implements IMessenger {
  name = "telegram";
  version = "1.0.0";
  private bot!: Bot;
  private messageHandler: MessageHandler | null = null;
  private deps: TelegramDeps | null = null;

  setDeps(deps: TelegramDeps): void {
    this.deps = deps;
  }

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as {
      messenger: {
        token: string;
        allowed_users: string[];
        allowed_chats: string[];
        group_mode: string;
      };
    };

    this.bot = new Bot(cfg.messenger.token);
    await this.bot.init();

    const botUsername = this.bot.botInfo.username;
    getLogger().info({ botUsername }, "Telegram bot initialized");

    // Middleware chain (order matters)
    this.bot.use(createLoggingMiddleware());
    this.bot.use(
      createAuthMiddleware(
        {
          allowed_users: cfg.messenger.allowed_users,
          allowed_chats: cfg.messenger.allowed_chats,
          group_mode: cfg.messenger.group_mode,
          botUsername,
        },
        this.deps?.t,
      ),
    );
    this.bot.use(createRateLimitMiddleware({ maxPerSecond: 1, maxPerHour: 100 }, this.deps?.t));

    // Error handler
    this.bot.catch((err) => {
      getLogger().error({ err: err.error }, "Grammy error");
    });
  }

  async start(): Promise<void> {
    if (!this.deps) {
      throw new Error("TelegramMessenger.setDeps() must be called before start()");
    }

    // Register commands
    registerCommands(this.bot, this.deps);

    // Register message handlers
    if (this.messageHandler) {
      registerTextHandler(this.bot, this.messageHandler);
      registerMediaHandler(this.bot, this.messageHandler, this.deps.t);

      // Stage 5: Voice handler (if STT enabled)
      if (this.deps.sttProvider) {
        registerVoiceHandler(this.bot, this.messageHandler, this.deps.sttProvider, this.deps.t);
      }
    }

    // Stage 5+6: Callback handler (for inline buttons — voice + code delete)
    registerCallbackHandler(this.bot, {
      ttsProvider: this.deps.ttsProvider,
      codeExecutor: this.deps.codeExecutor,
      t: this.deps.t,
    });

    // Start long polling
    this.bot.start({
      onStart: () => getLogger().info("Telegram bot started (long polling)"),
    });
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async sendMessage(chatId: number, text: string, options?: SendOptions): Promise<number> {
    const sent = await this.bot.api.sendMessage(chatId, text, {
      parse_mode: options?.parse_mode,
    });
    return sent.message_id;
  }

  async editMessage(
    chatId: number,
    messageId: number,
    text: string,
    options?: SendOptions,
  ): Promise<void> {
    await this.bot.api.editMessageText(chatId, messageId, text, {
      parse_mode: options?.parse_mode,
    });
  }

  async sendChatAction(chatId: number, action: string): Promise<void> {
    await this.bot.api.sendChatAction(chatId, action as "typing");
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.bot.api.getMe();
      return { healthy: true, lastCheck: new Date() };
    } catch (err) {
      return { healthy: false, message: String(err), lastCheck: new Date() };
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  get api() {
    return this.bot.api;
  }
}
