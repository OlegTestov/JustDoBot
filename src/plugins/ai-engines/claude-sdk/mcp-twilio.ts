import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getLogger } from "../../../core/logger";
import type { TwilioCallProvider } from "../../voice/twilio-calls/index";

export interface TwilioMcpConfig {
  userPhoneNumber: string;
  language: string;
}

const MAX_MESSAGE_LENGTH = 500;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between calls

export function createTwilioMcpServer(
  twilioProvider: TwilioCallProvider,
  config: TwilioMcpConfig,
): McpSdkServerConfigWithInstance {
  const logger = getLogger();
  let lastCallTime = 0;

  const makePhoneCallTool = tool(
    "make_phone_call",
    "Make a phone call to the user. The message will be read aloud using text-to-speech. " +
      "Use ONLY when the user explicitly asks you to call them, or for genuinely urgent reminders " +
      "the user pre-approved (e.g. 'call me if I forget about...'). " +
      `Max message length: ${MAX_MESSAGE_LENGTH} chars. Cooldown: 5 minutes between calls.`,
    {
      message: z
        .string()
        .max(MAX_MESSAGE_LENGTH)
        .describe("The message to read aloud during the call (2-3 sentences max)"),
      reason: z.string().optional().describe("Why you are making the call (for logging)"),
    },
    async (args) => {
      try {
        // Cooldown guard
        const now = Date.now();
        if (now - lastCallTime < COOLDOWN_MS) {
          const waitSec = Math.ceil((COOLDOWN_MS - (now - lastCallTime)) / 1000);
          return {
            content: [
              {
                type: "text" as const,
                text: `Phone call cooldown active. Please wait ${waitSec} seconds before calling again.`,
              },
            ],
            isError: true,
          };
        }

        const truncated = args.message.slice(0, MAX_MESSAGE_LENGTH);
        const result = await twilioProvider.makeCall(
          config.userPhoneNumber,
          truncated,
          config.language,
        );
        lastCallTime = Date.now();
        logger.info(
          { callSid: result.callSid, reason: args.reason },
          "Phone call initiated via MCP tool",
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Phone call initiated (callSid: ${result.callSid}, status: ${result.status}).`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "make_phone_call tool error");
        return {
          content: [{ type: "text" as const, text: `Error making phone call: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "twilio",
    version: "1.0.0",
    tools: [makePhoneCallTool],
  });
}
