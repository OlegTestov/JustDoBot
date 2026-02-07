import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { InlineKeyboard } from "grammy";
import { z } from "zod";
import type { ICodeExecutor, TaskCallbacks } from "../../core/interfaces";
import { getLogger } from "../../core/logger";
import { splitMessage } from "../../core/message-splitter";
import type { Translator } from "../../locales";
import type { McpContext } from "../ai-engines/claude-sdk/mcp-memory";

export function createCodeExecutorMcpServer(
  executor: ICodeExecutor,
  mcpContext: McpContext,
  sendTelegramTo: (
    chatId: number,
    text: string,
    options?: { parse_mode?: string; reply_markup?: unknown },
  ) => Promise<number>,
  editTelegramTo: (
    chatId: number,
    messageId: number,
    text: string,
    options?: { parse_mode?: string },
  ) => Promise<void>,
  t: Translator,
): McpSdkServerConfigWithInstance {
  const logger = getLogger();

  const startCodingTask = tool(
    "start_coding_task",
    "Start a coding task in an isolated Docker sandbox with full development tools " +
      "(Bash, Write, Edit, Read, Glob, Grep, Node.js, Bun, Python, Git). " +
      "Use when the user asks to: create an app/project, write and run code, " +
      "build something, fix code that needs execution, install packages, run tests, " +
      "clone and modify a repo. " +
      "The task runs in the BACKGROUND — the user will receive progress updates. " +
      "Provide a detailed, specific prompt for the coding agent. " +
      "For follow-up work on an existing project, use the SAME project name — " +
      "the agent remembers all previous work.",
    {
      project_name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/)
        .describe("Project name (lowercase, digits, hyphens, 2-32 chars). Reuse for follow-ups."),
      task_prompt: z
        .string()
        .min(10)
        .max(10000)
        .describe(
          "Detailed task for the coding agent. Include: what to build, tech stack, requirements, expected structure.",
        ),
    },
    async (args) => {
      try {
        // Create project if new
        const existing = await executor.getProject(args.project_name);
        if (!existing) {
          await executor.createProject(args.project_name, mcpContext.userId);
        }

        // Check if task is already running
        if (executor.isTaskRunning(args.project_name)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Task already running for "${args.project_name}". Use /project_stop ${args.project_name} to cancel.`,
              },
            ],
          };
        }

        // Capture chatId NOW (at tool-call time)
        const capturedChatId = Number(mcpContext.userId);
        let statusMsgId: number | undefined;

        const callbacks: TaskCallbacks = {
          onProgress: async (text) => {
            try {
              const progressText = `\u2699\uFE0F <b>${escapeHtml(args.project_name)}</b>: ${escapeHtml(text.slice(0, 200))}`;
              if (!statusMsgId) {
                statusMsgId = await sendTelegramTo(capturedChatId, progressText, {
                  parse_mode: "HTML",
                });
              } else {
                await editTelegramTo(capturedChatId, statusMsgId, progressText, {
                  parse_mode: "HTML",
                });
              }
            } catch {
              /* rate limit or "message is not modified" — ignore */
            }
          },
          onComplete: async (result, projectName) => {
            try {
              const keyboard = new InlineKeyboard().text(
                t("code.delete"),
                `code_rm_${projectName}`,
              );

              const duration =
                result.durationMs > 0 ? `${Math.round(result.durationMs / 1000)}s` : "\u2014";

              const header =
                `\u2705 <b>${escapeHtml(projectName)}</b> \u2014 ${t("code.completed")}\n` +
                `\u23F1 ${duration} \u00B7 ${result.numTurns} turns` +
                (result.costUsd > 0 ? ` \u00B7 $${result.costUsd.toFixed(3)}` : "") +
                `\n\uD83D\uDCC2 <code>./workspace/code/${escapeHtml(projectName)}</code>`;

              const fullText = `${header}\n\n${escapeHtml(result.resultText)}`;
              const parts = splitMessage(fullText);

              await sendTelegramTo(capturedChatId, parts[0], {
                parse_mode: "HTML",
                reply_markup: keyboard,
              });
              for (let i = 1; i < parts.length; i++) {
                await sendTelegramTo(capturedChatId, parts[i], { parse_mode: "HTML" });
              }
            } catch (err) {
              logger.error({ err }, "Failed to send completion message");
            }
          },
          onError: async (error, projectName) => {
            try {
              const header = `\u274C <b>${escapeHtml(projectName)}</b> \u2014 ${t("code.failed")}`;
              const fullText = `${header}\n\n${escapeHtml(error)}`;
              const parts = splitMessage(fullText);

              for (const part of parts) {
                await sendTelegramTo(capturedChatId, part, { parse_mode: "HTML" });
              }
            } catch (err) {
              logger.error({ err }, "Failed to send error message");
            }
          },
        };

        // Start background task (fire-and-forget)
        executor.runTaskInBackground(
          args.project_name,
          args.task_prompt,
          mcpContext.userId,
          callbacks,
        );

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Coding task started for project "${args.project_name}". ` +
                "The sandbox agent is now working on it. " +
                "The user will see progress updates in Telegram. " +
                `They can use /project_stop ${args.project_name} to cancel.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "code-executor",
    version: "1.0.0",
    tools: [startCodingTask],
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
