import type { Bot } from "grammy";
import { InlineKeyboard, InputFile } from "grammy";
import type { ICodeExecutor, ITTSProvider } from "../../../../core/interfaces";
import { getLogger } from "../../../../core/logger";
import type { Translator } from "../../../../locales";

// In-memory stores for TTS
const pendingTTS = new Map<string, AbortController>();
const messageTexts = new Map<string, string>();

// TTL cleanup: remove entries older than 1 hour
const TEXT_TTL_MS = 60 * 60 * 1000;
const textTimestamps = new Map<string, number>();

function cleanupOldTexts(): void {
  const now = Date.now();
  for (const [key, timestamp] of textTimestamps) {
    if (now - timestamp > TEXT_TTL_MS) {
      messageTexts.delete(key);
      textTimestamps.delete(key);
    }
  }
}

export function registerCallbackHandler(
  bot: Bot,
  deps: {
    ttsProvider?: ITTSProvider;
    codeExecutor?: ICodeExecutor;
    t: Translator;
  },
): void {
  const logger = getLogger();

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    // ─── skip_audio_{key} ── Cancel TTS generation ──────────
    if (data.startsWith("skip_audio_")) {
      const key = data.replace("skip_audio_", "");
      const controller = pendingTTS.get(key);
      if (controller) {
        controller.abort();
        pendingTTS.delete(key);
        logger.info({ key }, "TTS cancelled by user");
      }
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        /* "message is not modified" — ignore */
      }
      await ctx.answerCallbackQuery({ text: deps.t("voice.skipConfirm") });
      return;
    }

    // ─── listen_{key} ── Generate TTS on-demand ────────
    if (data.startsWith("listen_")) {
      const key = data.replace("listen_", "");
      const text = messageTexts.get(key);

      if (!text || !deps.ttsProvider) {
        await ctx.answerCallbackQuery({ text: deps.t("voice.unavailable") });
        return;
      }

      await ctx.answerCallbackQuery({ text: deps.t("voice.generating") });

      try {
        const chatId = ctx.callbackQuery.message?.chat.id;
        if (!chatId) return;

        await ctx.api.sendChatAction(chatId, "record_voice");
        const audioBuffer = await deps.ttsProvider.synthesize(text);
        await ctx.api.sendVoice(chatId, new InputFile(audioBuffer, "voice.ogg"));

        // Cleanup: remove button and text from memory
        messageTexts.delete(key);
        textTimestamps.delete(key);
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch {
          /* ignore */
        }
      } catch (err) {
        logger.error({ err }, "On-demand TTS failed");
      }
      return;
    }

    // ─── code_rm_confirm_{name} — actually delete project ───
    if (data.startsWith("code_rm_confirm_") && deps.codeExecutor) {
      const projectName = data.replace("code_rm_confirm_", "");
      try {
        await deps.codeExecutor.deleteProject(projectName);
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        await ctx.answerCallbackQuery({
          text: deps.t("cmd.projectDelete.done", { name: projectName }),
        });
      } catch (err) {
        logger.error({ err, projectName }, "Delete failed");
        await ctx.answerCallbackQuery({ text: "Delete failed" });
      }
      return;
    }

    // ─── code_rm_cancel_{name} — cancel deletion ─────────
    if (data.startsWith("code_rm_cancel_") && deps.codeExecutor) {
      const projectName = data.replace("code_rm_cancel_", "");
      const keyboard = new InlineKeyboard().text(deps.t("code.delete"), `code_rm_${projectName}`);
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    // ─── code_rm_{name} — show confirm/cancel buttons ────
    if (data.startsWith("code_rm_") && deps.codeExecutor) {
      const projectName = data.replace("code_rm_", "");
      const confirmKeyboard = new InlineKeyboard()
        .text(deps.t("code.confirmDelete"), `code_rm_confirm_${projectName}`)
        .text(deps.t("code.cancelDelete"), `code_rm_cancel_${projectName}`);
      await ctx.editMessageReplyMarkup({ reply_markup: confirmKeyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    // ─── Unknown callback ───────────────────────────────────
    logger.warn({ data }, "Unknown callback query");
    await ctx.answerCallbackQuery({ text: "Unknown action" });
  });
}

// Exported functions for use in main handler
export function storePendingTTS(key: string, controller: AbortController): void {
  pendingTTS.set(key, controller);
}

export function removePendingTTS(key: string): void {
  pendingTTS.delete(key);
}

export function storeMessageText(key: string, text: string): void {
  cleanupOldTexts();
  messageTexts.set(key, text);
  textTimestamps.set(key, Date.now());
}
