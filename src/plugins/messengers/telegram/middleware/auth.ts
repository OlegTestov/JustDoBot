import type { Context, NextFunction } from "grammy";
import { getLogger } from "../../../../core/logger";
import type { Translator } from "../../../../locales";

export function createAuthMiddleware(
  config: {
    allowed_users: string[];
    allowed_chats: string[];
    group_mode: string;
    botUsername: string;
  },
  t?: Translator,
) {
  const logger = getLogger();

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (!ctx.from) return;

    const userId = String(ctx.from.id);
    const chatId = String(ctx.chat?.id);
    const chatType = ctx.chat?.type;

    if (!config.allowed_users.includes(userId)) {
      logger.warn({ userId, chatId }, "Unauthorized user — ignoring");
      if (chatType === "private" && ctx.message?.text?.startsWith("/start")) {
        try {
          await ctx.reply(
            t
              ? t("auth.private", { userId })
              : `This bot is private.\n\nYour Telegram ID: ${userId}\nIf you're the owner, add this ID to ALLOWED_USER_ID in .env`,
          );
        } catch {
          /* ignore send errors */
        }
      }
      return;
    }

    if (chatType !== "private") {
      if (config.allowed_chats.length > 0 && !config.allowed_chats.includes(chatId)) {
        logger.warn({ chatId }, "Unauthorized chat — ignoring");
        return;
      }

      if (config.group_mode === "mention_only") {
        const text = ctx.message?.text ?? ctx.message?.caption ?? "";
        if (!text.includes(`@${config.botUsername}`)) {
          return;
        }
      }
    }

    await next();
  };
}
