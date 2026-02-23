import { mkdir, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Bot } from "grammy";
import { formatUtcForTz } from "../../../../core/format-date";
import type {
  IAIEngine,
  ICodeExecutor,
  IEmbeddingProvider,
  IMemoryProvider,
  IVaultProvider,
} from "../../../../core/interfaces";
import { getLogger } from "../../../../core/logger";
import { markdownToTelegramHtml } from "../../../../core/safe-markdown";
import type { SessionManager } from "../../../../core/session-manager";
import type { Translator } from "../../../../locales";

export function registerCommands(
  bot: Bot,
  deps: {
    sessionManager: SessionManager;
    aiEngine: IAIEngine;
    botName: string;
    t: Translator;
    database?: IMemoryProvider;
    vaultProvider?: IVaultProvider;
    embeddingProvider?: IEmbeddingProvider;
    registry?: import("../../../../registry").PluginRegistry;
    checkInRepo?: import("../../../database/sqlite/check-ins").CheckInRepository;
    codeExecutor?: ICodeExecutor;
    codeExecutorError?: string;
    timezone: string;
  },
) {
  bot.command("start", async (ctx) => {
    const features = [
      deps.t("cmd.start.featureMemory"),
      deps.t("cmd.start.featureGoals"),
      deps.vaultProvider ? deps.t("cmd.start.featureVault") : null,
      deps.t("cmd.start.featureVoice"),
      deps.codeExecutor ? deps.t("cmd.start.featureCode") : null,
    ]
      .filter(Boolean)
      .map((f) => `- ${f}`)
      .join("\n");

    const vaultCmds = deps.vaultProvider
      ? `${deps.t("cmd.help.vault")}\n${deps.t("cmd.help.note")}\n${deps.t("cmd.help.reindex")}\n`
      : "";
    const codeCmds = deps.codeExecutor
      ? `${deps.t("cmd.help.projects")}\n${deps.t("cmd.help.projectStop")}\n${deps.t("cmd.help.projectDelete")}\n`
      : "";
    await ctx.reply(
      `${deps.t("cmd.start.greeting", { botName: deps.botName })}\n\n` +
        `${deps.t("cmd.start.whatICan")}\n${features}\n\n` +
        `${deps.t("cmd.start.sendMessage")}\n\n` +
        `${deps.t("cmd.start.commandsHeader")}\n` +
        `${deps.t("cmd.help.help")}\n` +
        `${deps.t("cmd.help.clear")}\n` +
        `${deps.t("cmd.help.cancel")}\n` +
        `${deps.t("cmd.help.goals")}\n` +
        `${deps.t("cmd.help.memory")}\n` +
        `${deps.t("cmd.help.forget")}\n` +
        vaultCmds +
        codeCmds +
        `${deps.t("cmd.help.backup")}\n` +
        deps.t("cmd.help.status"),
    );
  });

  bot.command("help", async (ctx) => {
    const vaultCmds = deps.vaultProvider
      ? `${deps.t("cmd.help.vault")}\n${deps.t("cmd.help.note")}\n${deps.t("cmd.help.reindex")}\n`
      : "";
    const codeCmds = deps.codeExecutor
      ? `${deps.t("cmd.help.projects")}\n${deps.t("cmd.help.projectStop")}\n${deps.t("cmd.help.projectDelete")}\n`
      : "";
    await ctx.reply(
      `${deps.t("cmd.help.title")}\n\n` +
        `${deps.t("cmd.help.start")}\n` +
        `${deps.t("cmd.help.help")}\n` +
        `${deps.t("cmd.help.clear")}\n` +
        `${deps.t("cmd.help.cancel")}\n` +
        `${deps.t("cmd.help.goals")}\n` +
        `${deps.t("cmd.help.memory")}\n` +
        `${deps.t("cmd.help.forget")}\n` +
        vaultCmds +
        codeCmds +
        `${deps.t("cmd.help.backup")}\n` +
        `${deps.t("cmd.help.quiet")}\n` +
        `${deps.t("cmd.help.status")}\n\n` +
        `${deps.t("cmd.help.voice")}\n\n` +
        deps.t("cmd.help.footer"),
    );
  });

  bot.command("clear", async (ctx) => {
    deps.sessionManager.clearSession(ctx.chat.id);
    await ctx.reply(deps.t("cmd.clear.done"));
  });

  bot.command("cancel", async (ctx) => {
    deps.aiEngine.abort();
    await ctx.reply(deps.t("cmd.cancel.done"));
  });

  // ─── Stage 5: /status Command ─────────────────────────────────

  bot.command("status", async (ctx) => {
    try {
      const startTime = (globalThis as Record<string, unknown>).__botStartTime as
        | number
        | undefined;
      const uptimeMs = startTime ? Date.now() - startTime : 0;
      const uptimeH = Math.floor(uptimeMs / 3_600_000);
      const uptimeM = Math.floor((uptimeMs % 3_600_000) / 60_000);
      const uptimeStr = uptimeH > 0 ? `${uptimeH}h ${uptimeM}m` : `${uptimeM}m`;

      let totalMessages = 0;
      let todayMessages = 0;
      let memoriesCount = 0;
      let goalsCount = 0;

      if (deps.database) {
        const db = deps.database as {
          getDatabase?: () => {
            prepare: (sql: string) => {
              get: (...args: unknown[]) => Record<string, number> | undefined;
            };
          };
        };
        if (db.getDatabase) {
          const raw = db.getDatabase();
          const totalRow = raw.prepare("SELECT COUNT(*) as cnt FROM messages").get();
          totalMessages = (totalRow as Record<string, number> | undefined)?.cnt ?? 0;

          const today = formatUtcForTz(new Date().toISOString(), deps.timezone).split(" ")[0];
          const todayRow = raw
            .prepare("SELECT COUNT(*) as cnt FROM messages WHERE created_at >= ?")
            .get(today);
          todayMessages = (todayRow as Record<string, number> | undefined)?.cnt ?? 0;
        }

        if (deps.database.getMemories) {
          const mems = await deps.database.getMemories({ active: true, limit: 1000 });
          memoriesCount = mems.length;
        }
        if (deps.database.getActiveGoals) {
          const goals = await deps.database.getActiveGoals();
          goalsCount = goals.length;
        }
      }

      let vaultDocs = 0;
      if (deps.vaultProvider) {
        vaultDocs = await deps.vaultProvider.getDocumentCount();
      }

      let lastCheckIn = "—";
      if (deps.checkInRepo) {
        const lastTime = deps.checkInRepo.getLastSentTime();
        if (lastTime) {
          const agoMs = Date.now() - new Date(lastTime).getTime();
          const agoMin = Math.floor(agoMs / 60_000);
          lastCheckIn = `${agoMin} ${deps.t("cmd.status.minutesAgo")}`;
        }
      }

      let pluginLines = "";
      if (deps.registry) {
        const health = await deps.registry.healthCheckAll();
        const items: string[] = [];
        for (const [name, status] of health) {
          items.push(`  ${status.healthy ? "\u2705" : "\u274c"} ${name}`);
        }
        pluginLines = items.join("\n");
      }

      const lines = [
        `<b>${deps.t("cmd.status.title")}</b>`,
        "",
        `${deps.t("cmd.status.uptime")}: ${uptimeStr}`,
        `${deps.t("cmd.status.messagesTotal")}: ${totalMessages}`,
        `${deps.t("cmd.status.messagesToday")}: ${todayMessages}`,
        `${deps.t("cmd.status.activeGoals")}: ${goalsCount}`,
        `${deps.t("cmd.status.memories")}: ${memoriesCount}`,
        deps.vaultProvider ? `${deps.t("cmd.status.vaultDocs")}: ${vaultDocs}` : null,
        deps.checkInRepo ? `${deps.t("cmd.status.lastCheckIn")}: ${lastCheckIn}` : null,
        "",
        `${deps.t("cmd.status.plugins")}:`,
        pluginLines,
      ];

      if (deps.codeExecutor) {
        const health = await deps.codeExecutor.healthCheck();
        const projects = await deps.codeExecutor.listProjects();
        const totalCost = projects.reduce((sum, p) => sum + (p.totalCostUsd ?? 0), 0);
        const statusIcon = (s: string) =>
          s === "running" ? "\u2705" : s === "stopped" ? "\u{1F534}" : "\u274c";
        const containerLabels = {
          running: deps.t("cmd.status.container.running"),
          stopped: deps.t("cmd.status.container.stopped"),
          not_found: deps.t("cmd.status.container.notFound"),
        } as Record<string, string>;
        const statusLabel = (s: string) => containerLabels[s] ?? s;
        lines.push(
          "",
          `\u{1F528} <b>Code Agent</b>`,
          `${deps.t("cmd.status.sandbox")}: ${statusIcon(health.sandboxStatus)} ${statusLabel(health.sandboxStatus)}`,
          `${deps.t("cmd.status.proxy")}: ${statusIcon(health.proxyStatus)} ${statusLabel(health.proxyStatus)}`,
          `${deps.t("cmd.status.sandboxImage")}: ${(await deps.codeExecutor.checkSandboxImage()) ? "\u2705" : "\u274c"}`,
          `${deps.t("cmd.status.runningTasks")}: ${health.runningTasks}`,
          `${deps.t("cmd.status.projects")}: ${projects.length}`,
          `${deps.t("cmd.status.totalCost")}: $${totalCost.toFixed(3)}`,
        );
      }

      const statusText = lines.filter((l) => l !== null).join("\n");
      await ctx.reply(statusText, { parse_mode: "HTML" });
    } catch (err) {
      getLogger().error({ err }, "/status command error");
      await ctx.reply(deps.t("cmd.status.error"));
    }
  });

  // ─── Stage 4 Commands ──────────────────────────────────────────

  bot.command("quiet", async (ctx) => {
    if (!deps.database) {
      await ctx.reply(deps.t("cmd.quiet.unavailable"));
      return;
    }
    try {
      const provider = deps.database as {
        getCheckInRepo?: () => {
          setQuietMode: (userId: string, until: string) => void;
          clearQuietMode: (userId: string) => void;
        };
      };
      if (!provider.getCheckInRepo) {
        await ctx.reply(deps.t("cmd.quiet.unavailable"));
        return;
      }

      const args = ctx.message?.text?.split(" ").slice(1);
      const hoursStr = args?.[0];

      if (!hoursStr) {
        const until = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        provider.getCheckInRepo().setQuietMode(String(ctx.from!.id), until);
        await ctx.reply(deps.t("cmd.quiet.enabled", { hours: 4 }));
        return;
      }

      if (hoursStr === "off") {
        provider.getCheckInRepo().clearQuietMode(String(ctx.from!.id));
        await ctx.reply(deps.t("cmd.quiet.disabled"));
        return;
      }

      const hours = Number(hoursStr);
      if (Number.isNaN(hours) || hours <= 0 || hours > 48) {
        await ctx.reply(deps.t("cmd.quiet.usage"));
        return;
      }

      const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      provider.getCheckInRepo().setQuietMode(String(ctx.from!.id), until);
      await ctx.reply(deps.t("cmd.quiet.enabled", { hours }));
    } catch (err) {
      getLogger().error({ err }, "/quiet command error");
      await ctx.reply(deps.t("cmd.quiet.error"));
    }
  });

  // ─── Stage 2 Commands ──────────────────────────────────────────

  bot.command("goals", async (ctx) => {
    if (!deps.database?.getActiveGoals) {
      await ctx.reply(deps.t("cmd.goals.unavailable"));
      return;
    }
    try {
      const goals = await deps.database.getActiveGoals();
      if (goals.length === 0) {
        await ctx.reply(deps.t("cmd.goals.empty"));
        return;
      }
      const lines = goals.map((g) => {
        let line = `#${g.id}: ${g.title}${g.deadline ? ` (${deps.t("cmd.goals.deadline", { deadline: g.deadline })})` : ""} [${g.status}]`;
        if (g.description) {
          line += `\n  ${g.description.length > 100 ? `${g.description.slice(0, 100)}…` : g.description}`;
        }
        return line;
      });
      await ctx.reply(`${deps.t("cmd.goals.title")}\n\n${lines.join("\n\n")}`);
    } catch (err) {
      getLogger().error({ err }, "/goals command error");
      await ctx.reply(deps.t("cmd.goals.error"));
    }
  });

  bot.command("memory", async (ctx) => {
    if (!deps.database?.getMemories) {
      await ctx.reply(deps.t("cmd.memory.unavailable"));
      return;
    }
    try {
      const searchQuery = ctx.message?.text?.split(" ").slice(1).join(" ");

      let memories: import("../../../../core/interfaces").Memory[] | undefined;
      if (searchQuery && deps.database.searchMemoriesHybrid) {
        const results = await deps.database.searchMemoriesHybrid(searchQuery, null, 20);
        const allMem = await deps.database.getMemories({
          active: true,
          limit: 100,
        });
        const memMap = new Map(allMem.map((m) => [m.id!, m]));
        memories = results.map((r) => memMap.get(r.id)).filter((m) => m !== undefined);
      } else {
        memories = await deps.database.getMemories({
          active: true,
          limit: 20,
        });
      }

      if (memories.length === 0) {
        await ctx.reply(
          searchQuery
            ? deps.t("cmd.memory.noMatch", { query: searchQuery })
            : deps.t("cmd.memory.empty"),
        );
        return;
      }
      const lines = memories.map((m) => `#${m.id}: [${m.category}] ${m.content}`);
      await ctx.reply(
        `${searchQuery ? deps.t("cmd.memory.titleSearch", { query: searchQuery }) : deps.t("cmd.memory.titleAll")}\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      getLogger().error({ err }, "/memory command error");
      await ctx.reply(deps.t("cmd.memory.error"));
    }
  });

  bot.command("forget", async (ctx) => {
    if (!deps.database?.deleteMemory) {
      await ctx.reply(deps.t("cmd.forget.unavailable"));
      return;
    }
    const idStr = ctx.message?.text?.split(" ")[1];
    if (!idStr || Number.isNaN(Number(idStr))) {
      await ctx.reply(deps.t("cmd.forget.usage"));
      return;
    }
    try {
      await deps.database.deleteMemory(Number(idStr));
      await ctx.reply(deps.t("cmd.forget.done", { id: idStr }));
    } catch (err) {
      getLogger().error({ err }, "/forget command error");
      await ctx.reply(deps.t("cmd.forget.error"));
    }
  });

  // ─── Stage 3 Commands ──────────────────────────────────────────

  bot.command("vault", async (ctx) => {
    if (!deps.vaultProvider) {
      await ctx.reply(deps.t("cmd.vault.unavailable"));
      return;
    }
    try {
      const query = ctx.message?.text?.split(" ").slice(1).join(" ");
      if (!query) {
        const count = await deps.vaultProvider.getDocumentCount();
        await ctx.reply(deps.t("cmd.vault.indexed", { count }));
        return;
      }

      let embedding: number[] | null = null;
      if (deps.embeddingProvider) {
        try {
          embedding = await deps.embeddingProvider.embed(query, "query");
        } catch {
          /* FTS only fallback */
        }
      }

      const results = await deps.vaultProvider.search(query, embedding, 5);
      if (results.length === 0) {
        await ctx.reply(deps.t("cmd.vault.noMatch", { query }));
        return;
      }
      const lines = results.map(
        (r) =>
          `**${r.title ?? basename(r.file_path)}** (${dirname(r.file_path)})\n${r.content.slice(0, 200)}...`,
      );
      const raw = `${deps.t("cmd.vault.title", { query })}\n\n${lines.join("\n\n")}`;
      const html = markdownToTelegramHtml(raw);
      try {
        await ctx.reply(html, { parse_mode: "HTML" });
      } catch {
        await ctx.reply(raw);
      }
    } catch (err) {
      getLogger().error({ err }, "/vault command error");
      await ctx.reply(deps.t("cmd.vault.error"));
    }
  });

  bot.command("note", async (ctx) => {
    if (!deps.vaultProvider?.writeNote) {
      await ctx.reply(deps.t("cmd.vault.unavailable"));
      return;
    }
    const text = ctx.message?.text?.split(" ").slice(1).join(" ");
    if (!text) {
      await ctx.reply(deps.t("cmd.note.usage"));
      return;
    }
    try {
      const firstLine = text.split("\n")[0].slice(0, 60);
      const title = firstLine.replace(/[/\\:*?"<>|]/g, "").trim() || "Untitled";
      const now = new Date().toISOString();
      const content = `# ${title}\n\n${text}\n\nCreated: ${now}\n`;
      const relativePath = `Temp Notes/${title}.md`;

      await deps.vaultProvider.writeNote(relativePath, content);
      await ctx.reply(deps.t("cmd.note.created", { path: relativePath }));
    } catch (err) {
      getLogger().error({ err }, "/note command error");
      await ctx.reply(deps.t("cmd.note.error"));
    }
  });

  bot.command("reindex", async (ctx) => {
    if (!deps.vaultProvider) {
      await ctx.reply(deps.t("cmd.vault.unavailable"));
      return;
    }
    try {
      await ctx.reply(deps.t("cmd.reindex.progress"));
      const count = await deps.vaultProvider.index();
      await ctx.reply(deps.t("cmd.reindex.done", { count }));
    } catch (err) {
      getLogger().error({ err }, "/reindex command error");
      await ctx.reply(deps.t("cmd.reindex.error"));
    }
  });

  // ─── Stage 6: Code Agent Commands ─────────────────────────────

  bot.command("projects", async (ctx) => {
    if (!deps.codeExecutor) {
      await ctx.reply(
        deps.codeExecutorError
          ? deps.t("code.startupFailed", {
              error: deps.codeExecutorError,
              restartCmd: "bun run docker",
              rebuildCmd: "bun run docker:build",
            })
          : deps.t("code.unavailable"),
      );
      return;
    }
    const userId = String(ctx.from?.id ?? "");
    const projects = await deps.codeExecutor.listProjects(userId);
    if (projects.length === 0) {
      await ctx.reply(deps.t("cmd.projects.empty"));
      return;
    }
    const statusIcon: Record<string, string> = {
      running: "\u23F3",
      completed: "\u2705",
      error: "\u274c",
      active: "\uD83D\uDCC1",
      deleted: "\uD83D\uDDD1",
    };
    const lines = projects.map((p, i) => {
      const icon = statusIcon[p.status] ?? "\uD83D\uDCC1";
      const duration = p.lastTaskDurationMs
        ? ` \u2014 ${Math.round(p.lastTaskDurationMs / 1000)}s`
        : "";
      const cost = p.totalCostUsd ? ` \u00b7 $${p.totalCostUsd.toFixed(3)}` : "";
      return `${i + 1}. ${icon} <b>${p.name}</b> [${p.status}]${duration}${cost}`;
    });
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.command("project_stop", async (ctx) => {
    if (!deps.codeExecutor) {
      await ctx.reply(
        deps.codeExecutorError
          ? deps.t("code.startupFailed", {
              error: deps.codeExecutorError,
              restartCmd: "bun run docker",
              rebuildCmd: "bun run docker:build",
            })
          : deps.t("code.unavailable"),
      );
      return;
    }
    const name = ctx.match?.trim();
    if (!name) {
      await ctx.reply(deps.t("cmd.projectStop.usage"));
      return;
    }
    if (!deps.codeExecutor.isTaskRunning(name)) {
      await ctx.reply(deps.t("cmd.projectStop.notRunning", { name }));
      return;
    }
    await deps.codeExecutor.cancelTask(name);
    await ctx.reply(deps.t("cmd.projectStop.done", { name }));
  });

  bot.command("project_delete", async (ctx) => {
    if (!deps.codeExecutor) {
      await ctx.reply(
        deps.codeExecutorError
          ? deps.t("code.startupFailed", {
              error: deps.codeExecutorError,
              restartCmd: "bun run docker",
              rebuildCmd: "bun run docker:build",
            })
          : deps.t("code.unavailable"),
      );
      return;
    }
    const name = ctx.match?.trim();
    if (!name) {
      await ctx.reply(deps.t("cmd.projectDelete.usage"));
      return;
    }
    const project = await deps.codeExecutor.getProject(name);
    if (!project) {
      await ctx.reply(deps.t("cmd.projectDelete.notFound", { name }));
      return;
    }
    await deps.codeExecutor.deleteProject(name);
    await ctx.reply(deps.t("cmd.projectDelete.done", { name }));
  });

  // ─── Backup ───────────────────────────────────────────────────

  bot.command("backup", async (ctx) => {
    if (!deps.database) {
      await ctx.reply(deps.t("cmd.backup.unavailable"));
      return;
    }
    try {
      const provider = deps.database as {
        getDatabase?: () => {
          exec: (sql: string) => void;
          prepare: (sql: string) => { all: () => unknown[]; get: () => unknown };
        };
      };
      if (!provider.getDatabase) {
        await ctx.reply(deps.t("cmd.backup.unsupported"));
        return;
      }
      const backupDir = "./backups";
      await mkdir(backupDir, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      const db = provider.getDatabase();

      // JSON export
      const memories = db.prepare("SELECT * FROM memories WHERE active = 1").all();
      const goals = db.prepare("SELECT * FROM goals").all();
      const messageCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as { cnt: number }
      ).cnt;
      let vaultDocCount = 0;
      try {
        vaultDocCount = (
          db.prepare("SELECT COUNT(*) as cnt FROM vault_documents").get() as { cnt: number }
        ).cnt;
      } catch {
        /* table may not exist */
      }
      let checkInCount = 0;
      try {
        checkInCount = (
          db.prepare("SELECT COUNT(*) as cnt FROM check_in_logs").get() as { cnt: number }
        ).cnt;
      } catch {
        /* table may not exist */
      }
      let projects: unknown[] = [];
      try {
        projects = db.prepare("SELECT * FROM projects WHERE status != 'deleted'").all();
      } catch {
        /* table may not exist */
      }
      const jsonData = {
        exported_at: new Date().toISOString(),
        stats: {
          total_messages: messageCount,
          vault_documents: vaultDocCount,
          check_ins: checkInCount,
          projects: projects.length,
        },
        memories,
        goals,
        projects,
      };
      const jsonPath = `${backupDir}/backup-${date}.json`;
      await Bun.write(jsonPath, JSON.stringify(jsonData, null, 2));

      // SQLite backup — validate path before interpolation (VACUUM INTO does not support params)
      const dbPath = `${backupDir}/bot-${date}.db`;
      if (!/^[\w./-]+\.db$/.test(dbPath)) throw new Error(`Invalid backup path: ${dbPath}`);
      await unlink(dbPath).catch(() => {});
      db.exec(`VACUUM INTO '${dbPath}'`);

      await ctx.reply(
        deps.t("cmd.backup.done", {
          dbPath,
          jsonPath,
          memories: String(memories.length),
          goals: String(goals.length),
        }),
      );
      getLogger().info({ dbPath, jsonPath }, "Full backup created");
    } catch (err) {
      getLogger().error({ err }, "/backup command error");
      await ctx.reply(deps.t("cmd.backup.error"));
    }
  });
}
