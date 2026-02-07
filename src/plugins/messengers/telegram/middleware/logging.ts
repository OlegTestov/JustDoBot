import type { Context, NextFunction } from "grammy";
import { getLogger } from "../../../../core/logger";

export function createLoggingMiddleware() {
  const logger = getLogger();

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    logger.info(
      {
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        chatType: ctx.chat?.type,
        messageType: ctx.message?.photo ? "photo" : ctx.message?.document ? "document" : "text",
        text: ctx.message?.text?.substring(0, 100),
      },
      "Incoming message",
    );

    await next();

    logger.debug({ duration: Date.now() - startTime }, "Message processed");
  };
}
