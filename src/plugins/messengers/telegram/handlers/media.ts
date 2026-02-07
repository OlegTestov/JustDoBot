import type { Bot } from "grammy";
import type { MessageHandler } from "../../../../core/interfaces";
import { getLogger } from "../../../../core/logger";
import type { Translator } from "../../../../locales";

export function registerMediaHandler(bot: Bot, handler: MessageHandler, t: Translator) {
  const logger = getLogger();

  // Photo handler
  bot.on("message:photo", async (ctx) => {
    const photo = ctx.message.photo;
    const largest = photo[photo.length - 1];
    const file = await ctx.api.getFile(largest.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    const caption = ctx.message.caption ?? "What do you see in this image?";

    await handler({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      text: caption,
      messageId: ctx.message.message_id,
      chatType: ctx.chat.type,
      photo: { url: fileUrl, fileId: largest.file_id },
      raw: ctx,
    });
  });

  // Document handler
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc) return;

    const fileName = doc.file_name ?? "unknown";
    const mimeType = doc.mime_type ?? "";

    const supportedTextExts = [".txt", ".md"];
    const isPdf = mimeType === "application/pdf" || fileName.endsWith(".pdf");
    const isDocx =
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx");
    const isText = supportedTextExts.some((ext) => fileName.endsWith(ext));
    const isImage = mimeType.startsWith("image/");

    if (!isPdf && !isDocx && !isText && !isImage) {
      await ctx.reply(t("media.unsupported"));
      return;
    }

    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    let textContent = "";

    if (isText) {
      const response = await fetch(fileUrl);
      textContent = await response.text();
    } else if (isPdf) {
      try {
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(buffer);
        textContent = data.text;
      } catch (err) {
        logger.error({ err }, "Failed to parse PDF");
        await ctx.reply(t("media.pdfError"));
        return;
      }
    } else if (isDocx) {
      try {
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        textContent = result.value;
      } catch (err) {
        logger.error({ err }, "Failed to parse DOCX");
        await ctx.reply(t("media.docxError"));
        return;
      }
    }

    const caption = ctx.message.caption ?? "";
    const prompt = isImage
      ? caption || "What do you see in this image?"
      : `${caption}\n\n--- Document: ${fileName} ---\n${textContent}`.trim();

    await handler({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      text: prompt,
      messageId: ctx.message.message_id,
      chatType: ctx.chat.type,
      document: isImage ? { url: fileUrl, fileId: doc.file_id } : undefined,
      raw: ctx,
    });
  });
}
