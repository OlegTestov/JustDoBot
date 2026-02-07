import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Bot } from "grammy";
import type { IAIEngine, IMemoryProvider, IVaultProvider } from "../../src/core/interfaces";
import type { SessionManager } from "../../src/core/session-manager";
import type { Translator } from "../../src/locales";
import type { CheckInRepository } from "../../src/plugins/database/sqlite/check-ins";
import { registerCommands } from "../../src/plugins/messengers/telegram/handlers/commands";
import type { PluginRegistry } from "../../src/registry";

// biome-ignore lint/suspicious/noExplicitAny: test mock handler signature
type AnyFn = (...args: any[]) => unknown;

function createMockBot() {
  const commands: Record<string, AnyFn> = {};
  return {
    command: mock((name: string, handler: AnyFn) => {
      commands[name] = handler;
    }),
    on: mock(() => {}),
    use: mock(() => {}),
    catch: mock(() => {}),
    _commands: commands,
  };
}

function createMockCtx() {
  return {
    reply: mock(() => Promise.resolve()),
    message: { text: "/status" },
    chat: { id: 123 },
    from: { id: 456 },
  };
}

function createMockTranslator(): Translator {
  return mock(
    (key: string, _vars?: Record<string, string | number>) => key,
  ) as unknown as Translator;
}

function createMockDatabase() {
  return {
    getDatabase: () => ({
      prepare: (sql: string) => ({
        get: (..._args: unknown[]) => {
          if (sql.includes("COUNT(*)") && !sql.includes("WHERE")) return { cnt: 100 };
          if (sql.includes("WHERE created_at")) return { cnt: 5 };
          return { cnt: 0 };
        },
      }),
    }),
    getMemories: mock(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]),
    getActiveGoals: mock(async () => [{ id: 1, title: "Test goal" }]),
  };
}

function createMockSessionManager(): SessionManager {
  return { clearSession: mock(() => {}) } as unknown as SessionManager;
}

function createMockAIEngine(): IAIEngine {
  return { abort: mock(() => {}) } as unknown as IAIEngine;
}

const g = globalThis as unknown as Record<string, unknown>;

describe("/status command", () => {
  let bot: ReturnType<typeof createMockBot>;
  let originalBotStartTime: unknown;

  beforeEach(() => {
    bot = createMockBot();
    originalBotStartTime = g.__botStartTime;
  });

  test("shows full status with all data", async () => {
    g.__botStartTime = Date.now() - 3_600_000; // 1 hour ago

    const mockDb = createMockDatabase();
    const mockRegistry = {
      healthCheckAll: mock(async () => {
        const map = new Map();
        map.set("ai-engine", { healthy: true, lastCheck: new Date() });
        map.set("memory", { healthy: true, lastCheck: new Date() });
        return map;
      }),
    };
    const mockVault = {
      getDocumentCount: mock(async () => 42),
    };
    const lastCheckInTime = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 minutes ago
    const mockCheckInRepo = {
      getLastSentTime: mock(() => lastCheckInTime),
    };

    registerCommands(bot as unknown as Bot, {
      sessionManager: createMockSessionManager(),
      aiEngine: createMockAIEngine(),
      botName: "TestBot",
      t: createMockTranslator(),
      database: mockDb as unknown as IMemoryProvider,
      vaultProvider: mockVault as unknown as IVaultProvider,
      registry: mockRegistry as unknown as PluginRegistry,
      checkInRepo: mockCheckInRepo as unknown as CheckInRepository,
    });

    const ctx = createMockCtx();
    await bot._commands.status(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;

    // Verify key sections are present
    expect(replyText).toContain("cmd.status.title");
    expect(replyText).toContain("cmd.status.uptime");
    expect(replyText).toContain("1h 0m");
    expect(replyText).toContain("100"); // total messages
    expect(replyText).toContain("5"); // today messages
    expect(replyText).toContain("cmd.status.activeGoals");
    expect(replyText).toContain("cmd.status.memories");
    expect(replyText).toContain("cmd.status.vaultDocs");
    expect(replyText).toContain("cmd.status.lastCheckIn");
    expect(replyText).toContain("cmd.status.plugins");

    // Verify parse_mode HTML is set
    const replyOpts = ctx.reply.mock.calls[0][1];
    expect(replyOpts).toEqual({ parse_mode: "HTML" });

    // Restore
    g.__botStartTime = originalBotStartTime;
  });

  test("works without vault provider", async () => {
    g.__botStartTime = Date.now() - 60_000; // 1 minute ago

    const mockDb = createMockDatabase();

    registerCommands(bot as unknown as Bot, {
      sessionManager: createMockSessionManager(),
      aiEngine: createMockAIEngine(),
      botName: "TestBot",
      t: createMockTranslator(),
      database: mockDb as unknown as IMemoryProvider,
      // No vaultProvider
    });

    const ctx = createMockCtx();
    await bot._commands.status(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;

    // Should still have core status info
    expect(replyText).toContain("cmd.status.title");
    expect(replyText).toContain("cmd.status.uptime");
    expect(replyText).toContain("cmd.status.messagesTotal");

    // Should NOT contain vault-specific line
    expect(replyText).not.toContain("cmd.status.vaultDocs");

    // Restore
    g.__botStartTime = originalBotStartTime;
  });

  test("works without checkInRepo", async () => {
    g.__botStartTime = Date.now() - 120_000; // 2 minutes ago

    const mockDb = createMockDatabase();

    registerCommands(bot as unknown as Bot, {
      sessionManager: createMockSessionManager(),
      aiEngine: createMockAIEngine(),
      botName: "TestBot",
      t: createMockTranslator(),
      database: mockDb as unknown as IMemoryProvider,
      // No checkInRepo
    });

    const ctx = createMockCtx();
    await bot._commands.status(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;

    // Should still have core status info
    expect(replyText).toContain("cmd.status.title");
    expect(replyText).toContain("cmd.status.uptime");

    // Should NOT contain check-in line
    expect(replyText).not.toContain("cmd.status.lastCheckIn");

    // Restore
    g.__botStartTime = originalBotStartTime;
  });

  test("shows plugin health", async () => {
    g.__botStartTime = Date.now();

    const mockRegistry = {
      healthCheckAll: mock(async () => {
        const map = new Map();
        map.set("ai-engine", { healthy: true, lastCheck: new Date() });
        map.set("memory", { healthy: false, lastCheck: new Date(), message: "DB error" });
        return map;
      }),
    };

    registerCommands(bot as unknown as Bot, {
      sessionManager: createMockSessionManager(),
      aiEngine: createMockAIEngine(),
      botName: "TestBot",
      t: createMockTranslator(),
      registry: mockRegistry as unknown as PluginRegistry,
    });

    const ctx = createMockCtx();
    await bot._commands.status(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;

    // Verify plugin names appear in output
    expect(replyText).toContain("ai-engine");
    expect(replyText).toContain("memory");

    // Verify healthy/unhealthy indicators
    expect(replyText).toContain("\u2705"); // checkmark for healthy
    expect(replyText).toContain("\u274c"); // cross for unhealthy

    // Restore
    g.__botStartTime = originalBotStartTime;
  });

  test("handles error gracefully", async () => {
    g.__botStartTime = Date.now();

    const brokenDb = {
      getDatabase: () => ({
        prepare: () => {
          throw new Error("DB connection lost");
        },
      }),
      getMemories: mock(async () => []),
      getActiveGoals: mock(async () => []),
    };

    registerCommands(bot as unknown as Bot, {
      sessionManager: createMockSessionManager(),
      aiEngine: createMockAIEngine(),
      botName: "TestBot",
      t: createMockTranslator(),
      database: brokenDb as unknown as IMemoryProvider,
    });

    const ctx = createMockCtx();
    await bot._commands.status(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;

    // Should show error message (the translator returns the key itself)
    expect(replyText).toBe("cmd.status.error");

    // Restore
    g.__botStartTime = originalBotStartTime;
  });
});
