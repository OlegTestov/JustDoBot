import { getLogger } from "./logger";

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const logger = getLogger();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * 2 ** attempt;
      logger.warn(
        { attempt: attempt + 1, maxRetries, delay, error: String(error) },
        "Retrying after error",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("Unreachable");
}
