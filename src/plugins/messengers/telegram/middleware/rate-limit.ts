import type { Context, NextFunction } from "grammy";
import type { Translator } from "../../../../locales";

export function createRateLimitMiddleware(
  options: { maxPerSecond: number; maxPerHour: number },
  t?: Translator,
) {
  const lastMessage = new Map<number, number>();
  const hourlyCount = new Map<number, { count: number; resetAt: number }>();

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const now = Date.now();

    // Per-second limit
    const lastTime = lastMessage.get(userId) ?? 0;
    if (now - lastTime < 1000 / options.maxPerSecond) {
      return;
    }
    lastMessage.set(userId, now);

    // Hourly limit
    const hourly = hourlyCount.get(userId);
    if (hourly) {
      if (now > hourly.resetAt) {
        hourlyCount.set(userId, { count: 1, resetAt: now + 3_600_000 });
      } else if (hourly.count >= options.maxPerHour) {
        const minutesLeft = Math.ceil((hourly.resetAt - now) / 60_000);
        await ctx.reply(
          t
            ? t("rateLimit.exceeded", { max: options.maxPerHour, minutes: minutesLeft })
            : `Rate limit reached (${options.maxPerHour} messages/hour). Wait ~${minutesLeft} min.`,
        );
        return;
      } else {
        hourly.count++;
      }
    } else {
      hourlyCount.set(userId, { count: 1, resetAt: now + 3_600_000 });
    }

    await next();
  };
}
