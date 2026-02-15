import { z } from "zod";
import { LANGUAGE_NAMES } from "../locales";
import { formatUtcForTz } from "./format-date";
import type { IAIEngine } from "./interfaces";
import { getLogger } from "./logger";

export const GatingResultSchema = z.object({
  action: z.enum(["text", "call", "skip"]),
  urgency: z.number().min(1).max(10),
  message: z.string().optional(),
  reason: z.string().optional(),
});

export type GatingResult = z.infer<typeof GatingResultSchema>;

const GATING_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["text", "call", "skip"] },
    urgency: { type: "number", minimum: 1, maximum: 10 },
    message: { type: "string" },
    reason: { type: "string" },
  },
  required: ["action", "urgency"],
};

export async function runGatingQuery(
  aiEngine: IAIEngine,
  collectedData: unknown,
  recentCheckIns: Array<{ message_sent?: string; created_at?: string }>,
  language = "en",
  timezone = "UTC",
  hasTwilio = false,
): Promise<GatingResult> {
  const logger = getLogger();
  const languageName = LANGUAGE_NAMES[language] || language;

  const now = new Date();
  const currentTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const dataSections = Object.entries(collectedData as Record<string, unknown>)
    .map(
      ([source, data]) =>
        `<external-data source="${source}">\n${JSON.stringify(data, null, 2)}\n</external-data>`,
    )
    .join("\n\n");

  const callOption = hasTwilio
    ? '\n- "call" = send text AND make a phone call (use ONLY for true emergencies: missed critical deadlines, urgent calendar conflicts, health/safety)'
    : "";

  const prompt = `You are a triage assistant. Review the collected data and decide:
1. Should I send a proactive message to the user? (text${hasTwilio ? "/call" : ""}/skip)
2. Urgency level (1-10)
3. If "text"${hasTwilio ? ' or "call"' : ""}, provide a SHORT message (2-3 sentences max) in ${languageName}
4. If "skip", provide reason in English

Actions:
- "text" = send a Telegram message
- "skip" = do nothing${callOption}

Current time: ${currentTime} (${timezone})

Recent check-ins (last 3):
${recentCheckIns.map((c) => `- ${c.created_at ? formatUtcForTz(c.created_at, timezone) : "?"}: ${c.message_sent ?? "skipped"}`).join("\n") || "- No recent check-ins"}

Collected data:
${dataSections}`;

  try {
    if (!aiEngine.queryStructured) {
      throw new Error("AI engine does not support structured queries");
    }

    const result = await aiEngine.queryStructured<GatingResult>(prompt, GATING_JSON_SCHEMA);
    const validated = GatingResultSchema.parse(result);
    return validated;
  } catch (err) {
    logger.error({ err }, "Gating query failed");
    return {
      action: "skip",
      urgency: 1,
      reason: `Gating query error: ${String(err)}`,
    };
  }
}
