import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IEmbeddingProvider, IMemoryProvider, Memory } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export interface McpContext {
  userId: string;
  sessionId: string;
}

export function createMemoryMcpServer(
  db: IMemoryProvider,
  embeddingProvider: IEmbeddingProvider | null,
  _mcpContext: McpContext,
): McpSdkServerConfigWithInstance {
  const logger = getLogger();

  // ── Tool 1: save_memory ──
  const saveMemoryTool = tool(
    "save_memory",
    "Save a fact, preference, or insight about the user. " +
      "Use when the user shares personal info, preferences, or important context. " +
      "Do NOT ask permission — save automatically when information is meaningful.",
    {
      content: z.string().describe("The fact or preference to remember"),
      category: z.enum(["fact", "preference", "person", "insight"]).describe("Category of memory"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .default(0.8)
        .describe("Confidence score 0-1. Use 0.9+ for explicit statements, 0.5 for inferred"),
    },
    async (args) => {
      try {
        if (!db.saveMemory) {
          return {
            content: [{ type: "text" as const, text: "Memory system not available." }],
            isError: true,
          };
        }

        // Dedup: exact match check
        if (db.checkExactDuplicate) {
          const existing = await db.checkExactDuplicate(args.content);
          if (existing) {
            // Update confidence if higher
            if (db.updateMemory && args.confidence > (existing.confidence ?? 0)) {
              await db.updateMemory(existing.id!, {
                confidence: args.confidence,
              });
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Memory already exists (id: ${existing.id}), confidence updated.`,
                },
              ],
            };
          }
        }

        const id = await db.saveMemory({
          category: args.category,
          content: args.content,
          confidence: args.confidence,
          active: 1,
        });

        // Generate and save embedding if available
        if (embeddingProvider && db.saveVecMemory) {
          try {
            const embedding = await embeddingProvider.embed(args.content);
            if (embedding.length > 0) {
              await db.saveVecMemory(id, embedding);
            }
          } catch (e) {
            logger.warn({ err: e }, "Failed to generate embedding for memory");
          }
        }

        logger.info({ memoryId: id, category: args.category }, "Memory saved via MCP tool");
        return {
          content: [{ type: "text" as const, text: `Memory saved (id: ${id}).` }],
        };
      } catch (err) {
        logger.error({ err }, "save_memory tool error");
        return {
          content: [{ type: "text" as const, text: `Error saving memory: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 2: edit_memory ──
  const editMemoryTool = tool(
    "edit_memory",
    "Edit an existing memory's content, category, or confidence. " +
      "Use when user corrects a previously saved fact or when information becomes outdated. " +
      "Requires the memory ID (shown as #N in Memories section).",
    {
      memoryId: z.number().describe("Memory ID to update"),
      content: z.string().optional().describe("New content text"),
      category: z
        .enum(["fact", "preference", "person", "insight"])
        .optional()
        .describe("New category"),
      confidence: z.number().min(0).max(1).optional().describe("New confidence score 0-1"),
    },
    async (args) => {
      try {
        if (!db.updateMemory) {
          return {
            content: [{ type: "text" as const, text: "Memory update not available." }],
            isError: true,
          };
        }

        const updates: Partial<Memory> = {};
        if (args.content !== undefined) updates.content = args.content;
        if (args.category !== undefined) updates.category = args.category;
        if (args.confidence !== undefined) updates.confidence = args.confidence;

        if (Object.keys(updates).length === 0) {
          return {
            content: [{ type: "text" as const, text: "No fields to update." }],
          };
        }

        await db.updateMemory(args.memoryId, updates);

        // Re-embed if content changed
        if (args.content && embeddingProvider && db.saveVecMemory) {
          try {
            const embedding = await embeddingProvider.embed(args.content);
            if (embedding.length > 0) {
              await db.saveVecMemory(args.memoryId, embedding);
            }
          } catch (e) {
            logger.warn({ err: e }, "Failed to re-embed memory after update");
          }
        }

        logger.info({ memoryId: args.memoryId, updates }, "Memory updated via MCP tool");
        return {
          content: [{ type: "text" as const, text: `Memory #${args.memoryId} updated.` }],
        };
      } catch (err) {
        logger.error({ err }, "update_memory tool error");
        return {
          content: [{ type: "text" as const, text: `Error updating memory: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 3: delete_memory ──
  const deleteMemoryTool = tool(
    "delete_memory",
    "Delete a memory that is no longer accurate or relevant. " +
      "This is a soft delete — the memory is deactivated, not permanently removed. " +
      "Use when user says 'forget that', 'that's wrong', or when a fact becomes obsolete.",
    {
      memoryId: z.number().describe("Memory ID to delete (shown as #N in Memories section)"),
    },
    async (args) => {
      try {
        if (!db.deleteMemory) {
          return {
            content: [{ type: "text" as const, text: "Memory deletion not available." }],
            isError: true,
          };
        }

        await db.deleteMemory(args.memoryId);

        logger.info({ memoryId: args.memoryId }, "Memory deleted via MCP tool");
        return {
          content: [{ type: "text" as const, text: `Memory #${args.memoryId} deleted.` }],
        };
      } catch (err) {
        logger.error({ err }, "delete_memory tool error");
        return {
          content: [{ type: "text" as const, text: `Error deleting memory: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 4: save_goal ──
  const saveGoalTool = tool(
    "save_goal",
    "Track a user's goal or deadline. " +
      "Use when user says 'I want to...', 'deadline is...', 'need to finish by...', " +
      "'my goal is...', or similar goal-setting phrases.",
    {
      title: z.string().describe("Short goal title"),
      description: z.string().optional().describe("Optional detailed description"),
      deadline: z.string().optional().describe("Optional deadline in YYYY-MM-DD format"),
    },
    async (args) => {
      try {
        if (!db.saveGoal) {
          return {
            content: [{ type: "text" as const, text: "Goal system not available." }],
            isError: true,
          };
        }

        const id = await db.saveGoal({
          title: args.title,
          description: args.description,
          status: "active",
          deadline: args.deadline,
        });

        // Generate and save embedding if available
        if (embeddingProvider && db.saveVecGoal) {
          try {
            const text = `${args.title} ${args.description ?? ""}`.trim();
            const embedding = await embeddingProvider.embed(text);
            if (embedding.length > 0) {
              await db.saveVecGoal(id, embedding);
            }
          } catch (e) {
            logger.warn({ err: e }, "Failed to generate embedding for goal");
          }
        }

        logger.info({ goalId: id, title: args.title }, "Goal saved via MCP tool");
        return {
          content: [
            {
              type: "text" as const,
              text: `Goal tracked: "${args.title}" (id: ${id})${args.deadline ? ` — deadline: ${args.deadline}` : ""}`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "save_goal tool error");
        return {
          content: [{ type: "text" as const, text: `Error saving goal: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Shared helper: resolve goal by ID or fuzzy title ──
  async function resolveGoalId(
    goalId: number | undefined,
    title: string | undefined,
  ): Promise<
    | { ok: true; id: number }
    | { ok: false; response: { content: Array<{ type: "text"; text: string }>; isError?: boolean } }
  > {
    if (goalId) return { ok: true, id: goalId };

    if (title && db.searchGoalsByTitle) {
      const matches = await db.searchGoalsByTitle(title);
      if (matches.length === 0) {
        return {
          ok: false,
          response: {
            content: [{ type: "text" as const, text: `No active goal found matching "${title}".` }],
          },
        };
      }
      if (matches.length > 1) {
        const list = matches.map((g) => `  #${g.id}: ${g.title}`).join("\n");
        return {
          ok: false,
          response: {
            content: [
              {
                type: "text" as const,
                text: `Multiple goals match "${title}". Please specify ID:\n${list}`,
              },
            ],
          },
        };
      }
      return { ok: true, id: matches[0].id! };
    }

    return {
      ok: false,
      response: {
        content: [
          { type: "text" as const, text: "Please provide goalId or title to identify the goal." },
        ],
      },
    };
  }

  // ── Tool 5: edit_goal ──
  const editGoalTool = tool(
    "edit_goal",
    "Edit an existing goal's title, description, or deadline. " +
      "Use goalId if known, or title for fuzzy lookup. " +
      "Use when user refines, corrects, or updates a goal. " +
      "Before creating a new goal with save_goal, check Active Goals — if similar exists, edit it instead.",
    {
      goalId: z.number().optional().describe("Goal ID if known"),
      title: z.string().optional().describe("Goal title for fuzzy search if ID unknown"),
      newTitle: z.string().optional().describe("New title"),
      newDescription: z.string().optional().describe("New description"),
      newDeadline: z
        .string()
        .optional()
        .describe("New deadline YYYY-MM-DD. Use empty string to remove deadline"),
      note: z.string().optional().describe("Optional note about the edit"),
    },
    async (args) => {
      try {
        if (!db.editGoal) {
          return {
            content: [{ type: "text" as const, text: "Goal editing not available." }],
            isError: true,
          };
        }

        const resolved = await resolveGoalId(args.goalId, args.title);
        if (!resolved.ok) return resolved.response;
        const targetId = resolved.id;

        const updates: { title?: string; description?: string; deadline?: string | null } = {};
        if (args.newTitle) updates.title = args.newTitle;
        if (args.newDescription !== undefined) updates.description = args.newDescription;
        if (args.newDeadline !== undefined)
          updates.deadline = args.newDeadline === "" ? null : args.newDeadline;

        if (Object.keys(updates).length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No fields to edit. Provide newTitle, newDescription, or newDeadline.",
              },
            ],
          };
        }

        const updated = await db.editGoal(targetId, updates, args.note);
        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Goal #${targetId} not found.` }],
            isError: true,
          };
        }

        // Re-embed if title or description changed
        if ((updates.title || updates.description) && embeddingProvider && db.saveVecGoal) {
          try {
            const text = `${updated.title} ${updated.description ?? ""}`.trim();
            const embedding = await embeddingProvider.embed(text);
            if (embedding.length > 0) {
              await db.saveVecGoal(targetId, embedding);
            }
          } catch (e) {
            logger.warn({ err: e }, "Failed to re-embed goal after edit");
          }
        }

        logger.info({ goalId: targetId, updates }, "Goal edited via MCP tool");
        return {
          content: [
            {
              type: "text" as const,
              text: `Goal #${targetId} edited: "${updated.title}"${updated.deadline ? ` — deadline: ${updated.deadline}` : ""}`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "edit_goal tool error");
        return {
          content: [{ type: "text" as const, text: `Error editing goal: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool 6: close_goal ──
  const closeGoalTool = tool(
    "close_goal",
    "Complete, pause, cancel, or resume an existing goal. " +
      "Use goalId if known, or title for fuzzy lookup. " +
      "Use when user says 'done', 'finished', 'cancel', 'pause', 'resume'.",
    {
      goalId: z.number().optional().describe("Goal ID if known"),
      title: z.string().optional().describe("Goal title for fuzzy search if ID unknown"),
      action: z
        .enum(["complete", "pause", "cancel", "resume"])
        .describe("Action to take on the goal"),
      note: z.string().optional().describe("Optional progress note"),
    },
    async (args) => {
      try {
        if (!db.updateGoal) {
          return {
            content: [{ type: "text" as const, text: "Goal system not available." }],
            isError: true,
          };
        }

        const resolved = await resolveGoalId(args.goalId, args.title);
        if (!resolved.ok) return resolved.response;
        const targetId = resolved.id;

        await db.updateGoal(targetId, args.action, args.note);

        logger.info({ goalId: targetId, action: args.action }, "Goal closed via MCP tool");
        return {
          content: [
            {
              type: "text" as const,
              text: `Goal #${targetId} ${args.action === "complete" ? "completed" : `${args.action}d`}.${args.note ? ` Note: ${args.note}` : ""}`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "close_goal tool error");
        return {
          content: [{ type: "text" as const, text: `Error closing goal: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "memory",
    version: "1.0.0",
    tools: [
      saveMemoryTool,
      editMemoryTool,
      deleteMemoryTool,
      saveGoalTool,
      editGoalTool,
      closeGoalTool,
    ],
  });
}
