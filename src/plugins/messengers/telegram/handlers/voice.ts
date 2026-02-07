import type { Bot } from "grammy";
import type { ISTTProvider, MessageHandler } from "../../../../core/interfaces";
import { getLogger } from "../../../../core/logger";
import type { Translator } from "../../../../locales";

export function registerVoiceHandler(
  bot: Bot,
  handler: MessageHandler,
  sttProvider: ISTTProvider,
  t: Translator,
): void {
  const logger = getLogger();

  // Voice messages (recorded in Telegram app, OGG/Opus)
  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message.voice;

    try {
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const format = file.file_path?.split(".").pop() ?? "oga";

      await ctx.reply(t("voice.transcribing"));
      const transcribedText = await sttProvider.transcribe(audioBuffer, format);
      logger.info(
        { duration: voice.duration, chars: transcribedText.length, format },
        "Voice transcribed",
      );

      await handler({
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        text: transcribedText,
        messageId: ctx.message.message_id,
        chatType: ctx.chat.type,
        voice: {
          buffer: audioBuffer,
          duration: voice.duration,
          mimeType: voice.mime_type ?? "audio/ogg",
        },
        raw: ctx,
      });
    } catch (err) {
      logger.error({ err }, "Voice processing failed");
      await ctx.reply(t("voice.error"));
    }
  });

  // Audio files (sent as attachments — MP3, WAV, FLAC, etc.)
  bot.on("message:audio", async (ctx) => {
    const audio = ctx.message.audio;

    try {
      const file = await ctx.api.getFile(audio.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const format = audio.mime_type?.split("/").pop() ?? file.file_path?.split(".").pop() ?? "ogg";

      await ctx.reply(t("voice.transcribing"));
      const transcribedText = await sttProvider.transcribe(audioBuffer, format);
      logger.info(
        { duration: audio.duration, chars: transcribedText.length, format },
        "Audio file transcribed",
      );

      await handler({
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        text: transcribedText,
        messageId: ctx.message.message_id,
        chatType: ctx.chat.type,
        voice: {
          buffer: audioBuffer,
          duration: audio.duration ?? 0,
          mimeType: audio.mime_type ?? "audio/ogg",
        },
        raw: ctx,
      });
    } catch (err) {
      logger.error({ err }, "Audio file processing failed");
      await ctx.reply(t("voice.error"));
    }
  });
}
