import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { InlineKeyboard, InputFile } from "grammy";
import { loadConfig } from "./config";
import { buildContext } from "./core/context-builder";
import type {
  ICodeExecutor,
  ICollector,
  IEmbeddingProvider,
  ISTTProvider,
  ITTSProvider,
  IVaultProvider,
} from "./core/interfaces";
import { createLogger } from "./core/logger";
import { MessageQueue } from "./core/message-queue";
import { ProactiveScheduler } from "./core/proactive-scheduler";
import { SessionManager } from "./core/session-manager";
import { createTranslator } from "./locales";
import { ClaudeSdkEngine, extractTextFromAssistant } from "./plugins/ai-engines/claude-sdk/index";
import type { McpContext } from "./plugins/ai-engines/claude-sdk/mcp-memory";
import { createMemoryMcpServer } from "./plugins/ai-engines/claude-sdk/mcp-memory";
import { createTwilioMcpServer } from "./plugins/ai-engines/claude-sdk/mcp-twilio";
import {
  ClaudeOAuthRefreshManager,
  injectClaudeCredentialsFromData,
} from "./plugins/ai-engines/claude-sdk/oauth-refresh";
import { buildSystemPrompt } from "./plugins/ai-engines/claude-sdk/prompts";
import { GoalsCollector } from "./plugins/collectors/goals/index";
import { GoogleCollectorProvider } from "./plugins/collectors/google/index";
import { VaultChangesCollector } from "./plugins/collectors/vault/index";
import type { CheckInRepository } from "./plugins/database/sqlite/check-ins";
import { SqliteMemoryProvider } from "./plugins/database/sqlite/index";
import { OpenAIEmbeddingProvider } from "./plugins/embeddings/openai/index";
import {
  removePendingTTS,
  storeMessageText,
  storePendingTTS,
} from "./plugins/messengers/telegram/handlers/callbacks";
import { TelegramMessenger } from "./plugins/messengers/telegram/index";
import { StreamingResponseHandler } from "./plugins/messengers/telegram/streaming";
import { ObsidianVaultProvider } from "./plugins/vault/obsidian/index";
import { ElevenLabsTTSProvider } from "./plugins/voice/elevenlabs-tts/index";
import { GeminiSTTProvider } from "./plugins/voice/gemini-stt/index";
import { GeminiTTSProvider } from "./plugins/voice/gemini-tts/index";
import { TwilioCallProvider } from "./plugins/voice/twilio-calls/index";
import { PluginRegistry } from "./registry";

async function main() {
  (globalThis as Record<string, unknown>).__botStartTime = Date.now();

  // 1. Load config
  const config = loadConfig();

  // 2. Initialize logger
  const logger = createLogger(config.logging.level, config.logging.format);
  logger.info("JustDoBot starting...");

  // Ensure credentials are available at the SDK path before any Claude query.
  const injected = injectClaudeCredentialsFromData();
  if (injected) {
    logger.info("Claude credentials injected into SDK path");
  }
  const oauthRefreshManager = new ClaudeOAuthRefreshManager();
  oauthRefreshManager.start();

  // 3. Create and register plugins
  const registry = new PluginRegistry();
  const database = new SqliteMemoryProvider();
  const aiEngine = new ClaudeSdkEngine();
  const messenger = new TelegramMessenger();

  registry.register("database", database);

  // Stage 2: Conditional embedding provider
  let embeddingProvider: IEmbeddingProvider | null = null;
  if (config.embedding.enabled) {
    embeddingProvider = new OpenAIEmbeddingProvider();
    registry.register("embedding", embeddingProvider);
  }

  // Stage 3: Conditional vault provider
  let vaultProvider: IVaultProvider | null = null;
  if (config.vault.enabled) {
    const vault = new ObsidianVaultProvider();
    vault.setDeps({ database, embeddingProvider });
    vaultProvider = vault;
    registry.register("vault", vaultProvider);
  }

  // Stage 5: Conditional STT provider
  let sttProvider: ISTTProvider | null = null;
  if (config.voice.stt.enabled) {
    sttProvider = new GeminiSTTProvider();
    registry.register("stt", sttProvider);
  }

  // Stage 5: Conditional TTS provider
  let ttsProvider: ITTSProvider | null = null;
  if (config.voice.tts.enabled) {
    ttsProvider =
      config.voice.tts.type === "gemini" ? new GeminiTTSProvider() : new ElevenLabsTTSProvider();
    registry.register("tts", ttsProvider);
  }

  // Stage 5: Conditional Twilio call provider
  let twilioProvider: TwilioCallProvider | null = null;
  if (config.voice.twilio.enabled) {
    twilioProvider = new TwilioCallProvider();
    registry.register("twilio", twilioProvider);
  }

  registry.register("ai_engine", aiEngine);
  registry.register("messenger", messenger);

  // 4. Init all plugins
  await registry.initAll(config as Record<string, unknown>);

  // Stage 6: Conditional code executor (initialized separately — non-fatal)
  let codeExecutor: ICodeExecutor | null = null;
  let codeExecutorError: string | undefined;
  if (config.code_execution.enabled) {
    try {
      const { DockerCodeExecutor } = await import("./plugins/code-executor/docker/index");
      const executor = new DockerCodeExecutor();
      executor.setDeps({
        projectRepo: database.getProjectRepo(),
        codeTaskRepo: database.getCodeTaskRepo(),
      });
      await executor.init({ code_execution: config.code_execution } as Record<string, unknown>);
      codeExecutor = executor;
      logger.info("Code executor initialized");

      // Push refreshed OAuth credentials to sandbox after each refresh
      oauthRefreshManager.setOnRefresh((json) => {
        executor
          .pushCredentials(json)
          .catch((refreshErr) =>
            logger.warn({ err: refreshErr }, "Failed to push credentials to sandbox"),
          );
      });
    } catch (err) {
      logger.error({ err }, "Code executor failed to initialize — feature disabled");
      codeExecutorError = err instanceof Error ? err.message : String(err);
    }
  }

  // 5. Create shared components
  const messageQueue = new MessageQueue();
  const sessionManager = new SessionManager(config.context.session_timeout_hours);

  // Create translator early — needed by MCP servers
  const t = createTranslator(config.bot.language);

  // Notify user in Telegram when OAuth credentials are permanently invalid
  oauthRefreshManager.setOnAuthFailed((reason) => {
    logger.error({ reason }, "OAuth credentials permanently invalid");
    const chatId = Number(config.messenger.allowed_users[0]);
    if (chatId) {
      messenger.sendMessage(chatId, t("error.general") + t("error.authExpired")).catch(() => {});
    }
  });

  // Stage 2: MCP context (mutable, set before each query)
  const mcpContext: McpContext = { userId: "", sessionId: "" };
  const checkInRepo: CheckInRepository = database.getCheckInRepo();
  const memoryMcpServer = createMemoryMcpServer(
    database,
    embeddingProvider,
    mcpContext,
    (goalId) => {
      checkInRepo.markGoalsReminded([goalId]);
    },
  );
  // biome-ignore lint: MCP servers are typed by the SDK internally
  const mcpServers: Record<string, any> = { memory: memoryMcpServer };

  // Stage 6: Code executor MCP server
  if (codeExecutor) {
    const { createCodeExecutorMcpServer } = await import("./plugins/code-executor/mcp-code-task");
    const codeMcpServer = createCodeExecutorMcpServer(
      codeExecutor,
      mcpContext,
      async (chatId, text, options) => {
        const msg = await messenger.api.sendMessage(chatId, text, {
          parse_mode: options?.parse_mode as "HTML" | undefined,
          reply_markup: options?.reply_markup as InlineKeyboard | undefined,
        });
        return msg.message_id;
      },
      async (chatId, messageId, text, options) => {
        try {
          await messenger.api.editMessageText(chatId, messageId, text, {
            parse_mode: options?.parse_mode as "HTML" | undefined,
          });
        } catch {
          /* "message is not modified" — ignore */
        }
      },
      t,
    );
    mcpServers["code-executor"] = codeMcpServer;
  }

  // Stage 5: Twilio MCP server
  if (twilioProvider && config.voice.twilio.user_phone_number) {
    const twilioMcpServer = createTwilioMcpServer(twilioProvider, {
      userPhoneNumber: config.voice.twilio.user_phone_number,
      language: config.bot.language,
    });
    mcpServers.twilio = twilioMcpServer;
  }

  // Stage 3: Initial vault indexing
  if (vaultProvider) {
    const count = await vaultProvider.index();
    logger.info({ count }, "Vault initial indexing complete");
    vaultProvider.startWatching();
  }

  // Stage 4: Collectors & Proactive Scheduler
  const collectors: ICollector[] = [];

  // Local collectors (no OAuth needed)
  if (config.proactive.enabled) {
    const goalsCollector = new GoalsCollector(database);
    registry.register("collector_goals", goalsCollector);
    collectors.push(goalsCollector);
  }
  if (vaultProvider) {
    const vaultCollector = new VaultChangesCollector(database);
    registry.register("collector_vault", vaultCollector);
    collectors.push(vaultCollector);
  }

  // Google collectors (requires OAuth)
  if (config.collectors.google.enabled) {
    const googleCollector = new GoogleCollectorProvider();
    registry.register("collector_google", googleCollector);
    collectors.push(googleCollector);
  }

  let proactiveScheduler: ProactiveScheduler | null = null;

  if (config.proactive.enabled && collectors.length > 0) {
    const allowedUsers = config.messenger.allowed_users;

    if (!allowedUsers.length) {
      logger.warn("No allowed users configured — proactive scheduler disabled");
    } else {
      const targetUserId = allowedUsers[0];
      const targetChatId = Number(targetUserId);

      if (Number.isNaN(targetChatId)) {
        logger.warn({ targetUserId }, "Invalid user ID — proactive scheduler disabled");
      } else {
        const twilioCallConfig =
          twilioProvider && config.voice.twilio.user_phone_number
            ? {
                enabled: true,
                urgencyThreshold: config.voice.twilio.urgency_threshold,
                userPhoneNumber: config.voice.twilio.user_phone_number,
              }
            : undefined;

        proactiveScheduler = new ProactiveScheduler(
          {
            enabled: true,
            checkIntervalMinutes: config.proactive.check_interval_minutes,
            cooldownMinutes: config.proactive.cooldown_minutes,
            reminderCooldownMinutes: config.proactive.reminder_cooldown_minutes,
            deferMinutes: config.proactive.defer_minutes,
            quietHours: config.proactive.quiet_hours,
            targetChatId,
            targetUserId,
            language: config.bot.language,
            timezone: config.bot.timezone,
            callConfig: twilioCallConfig,
          },
          {
            collectors,
            checkInRepo,
            aiEngine,
            messenger,
            messageQueue,
            sessionManager,
            twilioProvider: twilioProvider ?? undefined,
          },
        );
      }
    }
  }

  // 6. Wire dependencies for Telegram
  messenger.setDeps({
    sessionManager,
    aiEngine,
    botName: config.bot.name,
    database,
    vaultProvider: vaultProvider ?? undefined,
    embeddingProvider: embeddingProvider ?? undefined,
    sttProvider: sttProvider ?? undefined,
    ttsProvider: ttsProvider ?? undefined,
    registry,
    checkInRepo,
    codeExecutor: codeExecutor ?? undefined,
    codeExecutorError,
    timezone: config.bot.timezone,
    t,
  });

  // 7. Register message handler
  messenger.onMessage(async (msg) => {
    messageQueue.enqueue(async () => {
      const sessionId = sessionManager.getSessionId(msg.chatId);

      // Stage 2: Set MCP context for memory tools
      mcpContext.userId = String(msg.userId);
      mcpContext.sessionId = sessionId;

      // Save user message
      await database.saveMessage({
        session_id: sessionId,
        role: "user",
        content: msg.text,
        telegram_message_id: msg.messageId,
        media_type: msg.voice
          ? "voice"
          : msg.photo
            ? "photo"
            : msg.document
              ? "document"
              : undefined,
      });

      // Build context (Stage 4: with memories + goals + vault + check-ins)
      const context = await buildContext(
        sessionId,
        msg.text,
        database,
        config.context.max_tokens,
        embeddingProvider,
        config.context.budget,
        vaultProvider,
        config.bot.language,
        checkInRepo,
        config.bot.timezone,
      );

      // Create streaming handler
      const streamHandler = new StreamingResponseHandler(
        messenger.api,
        msg.chatId,
        config.streaming,
        t,
      );

      await streamHandler.start();

      const abortController = new AbortController();
      let fullText = "";
      let lastTextTurn = 0;
      let assistantTurnCount = 0;

      try {
        const systemPrompt = buildSystemPrompt(config.bot.name, context, t, {
          hasCodeExecutor: !!codeExecutor,
          hasTwilio: !!twilioProvider && !!config.voice.twilio.user_phone_number,
        });
        for await (const message of aiEngine.queryStream(msg.text, context, {
          abortController,
          mcpServers,
          systemPrompt,
        })) {
          switch (message.type) {
            case "stream_event": {
              const streamMsg = message as SDKPartialAssistantMessage;
              const event = streamMsg.event as {
                type?: string;
                delta?: { type?: string; text?: string };
              };
              if (
                event?.type === "content_block_delta" &&
                event?.delta?.type === "text_delta" &&
                event?.delta?.text
              ) {
                await streamHandler.onTextChunk(event.delta.text);
              }
              break;
            }

            case "assistant": {
              assistantTurnCount++;
              const assistantMsg = message as SDKAssistantMessage;
              const contentTypes = (assistantMsg.message.content as Array<{ type: string }>).map(
                (b) => b.type,
              );
              logger.debug({ turn: assistantTurnCount, contentTypes }, "Assistant turn");
              const text = extractTextFromAssistant(assistantMsg);
              if (text) {
                fullText += (fullText ? "\n\n" : "") + text;
                lastTextTurn = assistantTurnCount;
              }
              break;
            }

            case "result": {
              const resultMsg = message as SDKResultMessage;
              logger.info(
                {
                  duration_ms: resultMsg.duration_ms,
                  total_cost_usd: resultMsg.total_cost_usd,
                  num_turns: resultMsg.num_turns,
                  is_error: resultMsg.is_error,
                  lastTextTurn,
                  assistantTurnCount,
                },
                "Claude response complete",
              );

              // Warn if Claude used all turns and last text was early (likely ran out of turns)
              if (
                resultMsg.num_turns >= config.ai_engine.max_turns &&
                lastTextTurn < assistantTurnCount
              ) {
                logger.warn(
                  {
                    maxTurns: config.ai_engine.max_turns,
                    lastTextTurn,
                    totalTurns: assistantTurnCount,
                  },
                  "Claude exhausted max_turns — last text was not in final turn",
                );
              }
              break;
            }
          }
        }
      } catch (err) {
        if (err instanceof AbortError) {
          logger.info("Query timed out");
          streamHandler.cancel();
          if (fullText) {
            await database.saveMessage({
              session_id: sessionId,
              role: "assistant",
              content: fullText,
            });
          }
          return;
        }
        logger.error({ err }, "Error during Claude query");
        let userMessage = t("error.general");
        const errMsg = String(err);
        if (oauthRefreshManager.isAuthFailed()) {
          userMessage += t("error.authExpired");
        } else if (errMsg.includes("401") || errMsg.includes("auth") || errMsg.includes("Auth")) {
          userMessage += t("error.auth");
        } else if (errMsg.includes("rate") || errMsg.includes("429")) {
          userMessage += t("error.rateLimit");
        } else if (
          errMsg.includes("timeout") ||
          errMsg.includes("ETIMEDOUT") ||
          errMsg.includes("ETIMEOUT")
        ) {
          userMessage += t("error.timeout");
        } else {
          userMessage += t("error.retry");
        }
        try {
          await messenger.sendMessage(msg.chatId, userMessage);
        } catch {
          /* ignore */
        }
        return;
      }

      // Finalize streaming response
      await streamHandler.finalize(fullText);

      // Save assistant response
      if (fullText) {
        await database.saveMessage({
          session_id: sessionId,
          role: "assistant",
          content: fullText,
        });
      }

      // Stage 5: TTS integration after response
      if (fullText && config.voice.tts.enabled && ttsProvider) {
        const ttsText = fullText.slice(0, config.voice.tts.max_text_length);
        const ttsKey = `${msg.chatId}_${streamHandler.getLastMessageId() ?? Date.now()}`;
        const lastMsgId = streamHandler.getLastMessageId();

        if (config.voice.tts.auto_reply && msg.voice) {
          // Auto TTS for voice messages: add Skip button, fire-and-forget
          const keyboard = new InlineKeyboard().text(t("voice.skipButton"), `skip_audio_${ttsKey}`);
          if (lastMsgId) {
            try {
              await messenger.api.editMessageReplyMarkup(msg.chatId, lastMsgId, {
                reply_markup: keyboard,
              });
            } catch {
              /* ignore */
            }
          }

          const ttsAbort = new AbortController();
          storePendingTTS(ttsKey, ttsAbort);

          // Fire-and-forget TTS
          (async () => {
            try {
              if (ttsAbort.signal.aborted) return;
              await messenger.api.sendChatAction(msg.chatId, "record_voice");
              const audioBuffer = await ttsProvider!.synthesize(ttsText);
              if (ttsAbort.signal.aborted) return;
              await messenger.api.sendVoice(msg.chatId, new InputFile(audioBuffer, "voice.ogg"));
              // Remove skip button after successful send
              if (lastMsgId) {
                try {
                  await messenger.api.editMessageReplyMarkup(msg.chatId, lastMsgId, {
                    reply_markup: undefined,
                  });
                } catch {
                  /* ignore */
                }
              }
            } catch (err) {
              if (!ttsAbort.signal.aborted) {
                logger.error({ err }, "Auto TTS failed");
              }
            } finally {
              removePendingTTS(ttsKey);
            }
          })();
        } else if (!config.voice.tts.auto_reply || !msg.voice) {
          // On-demand: add Listen button, store text
          storeMessageText(ttsKey, ttsText);
          const keyboard = new InlineKeyboard().text(t("voice.listenButton"), `listen_${ttsKey}`);
          if (lastMsgId) {
            try {
              await messenger.api.editMessageReplyMarkup(msg.chatId, lastMsgId, {
                reply_markup: keyboard,
              });
            } catch {
              /* ignore */
            }
          }
        }
      }
    });
  });

  // 8. Start messenger (long polling)
  await messenger.start();
  if (proactiveScheduler) {
    proactiveScheduler.start();
  }
  logger.info("JustDoBot is running!");

  // Notify users if code executor was configured but failed to start
  if (codeExecutorError) {
    for (const userId of config.messenger.allowed_users) {
      const chatId = Number(userId);
      if (!Number.isNaN(chatId)) {
        messenger
          .sendMessage(chatId, t("code.dockerUnavailable", { error: codeExecutorError }))
          .catch((err) => logger.warn({ err, chatId }, "Failed to send code executor warning"));
      }
    }
  }

  // 9. Graceful shutdown
  let shuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown initiated");

    if (proactiveScheduler) {
      proactiveScheduler.stop();
    }
    oauthRefreshManager.stop();

    await messenger.stop();

    if (vaultProvider) {
      vaultProvider.stopWatching();
    }

    try {
      await Promise.race([
        messageQueue.drain(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Drain timeout")), 15_000),
        ),
      ]);
    } catch {
      logger.warn("Shutdown timeout — aborting current query");
      aiEngine.abort();
    }

    await database.flush();
    if (codeExecutor) {
      try {
        await codeExecutor.destroy();
      } catch (err) {
        logger.warn({ err }, "Code executor cleanup failed");
      }
    }
    await registry.destroyAll();

    logger.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
