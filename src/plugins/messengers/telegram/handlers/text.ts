import type { Bot } from "grammy";
import type { MessageHandler } from "../../../../core/interfaces";

export function registerTextHandler(bot: Bot, handler: MessageHandler) {
  bot.on("message:text", async (ctx) => {
    // Skip commands (handled by command handlers)
    if (ctx.message.text.startsWith("/")) return;

    await handler({
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      text: ctx.message.text,
      messageId: ctx.message.message_id,
      chatType: ctx.chat.type,
      raw: ctx,
    });
  });
}
