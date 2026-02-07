import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ProactiveConfig } from "../../src/core/proactive-scheduler";
import { isQuietHours, ProactiveScheduler } from "../../src/core/proactive-scheduler";

// ─── Test cast helpers (centralize `as any` for private access) ──

type SchedulerDeps = ConstructorParameters<typeof ProactiveScheduler>[1];

function asDeps(d: ReturnType<typeof createMockDeps>): SchedulerDeps {
  // biome-ignore lint/suspicious/noExplicitAny: mock deps don't fully match interface
  return d as any;
}

function tick(s: ProactiveScheduler): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: access private method in tests
  return (s as any).tick();
}

function getPrivate(s: ProactiveScheduler, field: string): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: access private fields in tests
  return (s as any)[field];
}

// ─── Helpers ─────────────────────────────────────────────────────

function createConfig(overrides?: Partial<ProactiveConfig>): ProactiveConfig {
  return {
    enabled: true,
    checkIntervalMinutes: 60,
    cooldownMinutes: 120,
    reminderCooldownMinutes: 240,
    deferMinutes: 5,
    quietHours: { start: "23:00", end: "07:00" },
    targetChatId: 123,
    targetUserId: "user1",
    language: "en",
    timezone: "UTC",
    ...overrides,
  };
}

/** Default gating result returned by aiEngine.queryStructured */
const GATING_SKIP = { action: "skip", urgency: 1, reason: "test default" };

function createMockDeps() {
  return {
    collectors: [
      {
        name: "goals-collector",
        version: "1.0.0",
        type: "goals" as const,
        init: mock(() => Promise.resolve()),
        destroy: mock(() => Promise.resolve()),
        healthCheck: mock(() => Promise.resolve({ healthy: true, lastCheck: new Date() })),
        collect: mock(() =>
          Promise.resolve({
            approaching: [{ id: 1, title: "Goal 1", deadline: "2025-07-01", status: "active" }],
          }),
        ),
      },
    ],
    checkInRepo: {
      getLastSentTime: mock(() => null as string | null),
      isQuietMode: mock(() => false),
      getRecentLogs: mock(() => [] as Array<{ data_hash?: string }>),
      getRecentlyRemindedGoalIds: mock(() => [] as number[]),
      saveLog: mock(() => 1),
      markGoalsReminded: mock(() => {}),
    },
    aiEngine: {
      name: "mock-ai",
      version: "1.0.0",
      init: mock(() => Promise.resolve()),
      destroy: mock(() => Promise.resolve()),
      healthCheck: mock(() => Promise.resolve({ healthy: true, lastCheck: new Date() })),
      queryStream: mock(),
      queryStructured: mock(() => Promise.resolve(GATING_SKIP)),
    },
    messenger: {
      name: "mock-messenger",
      version: "1.0.0",
      init: mock(() => Promise.resolve()),
      destroy: mock(() => Promise.resolve()),
      healthCheck: mock(() => Promise.resolve({ healthy: true, lastCheck: new Date() })),
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      sendMessage: mock(() => Promise.resolve(1)),
      editMessage: mock(() => Promise.resolve()),
      deleteMessage: mock(() => Promise.resolve()),
      sendVoice: mock(() => Promise.resolve(1)),
    },
    messageQueue: {
      isProcessing: mock(() => false),
      acquireQueryLock: mock(() => Promise.resolve(() => {})),
    },
    sessionManager: {
      getLastActivity: mock(() => null as number | null),
    },
  };
}

// ─── isQuietHours (existing tests) ──────────────────────────────

describe("isQuietHours", () => {
  test("returns true during quiet hours (same-day range)", () => {
    const now = new Date("2025-06-15T23:00:00");
    expect(isQuietHours(now, "22:00", "08:00")).toBe(true);
  });

  test("returns true during midnight-spanning quiet hours (early morning)", () => {
    const now = new Date("2025-06-15T03:00:00");
    expect(isQuietHours(now, "22:00", "08:00")).toBe(true);
  });

  test("returns false outside quiet hours (same-day range)", () => {
    const now = new Date("2025-06-15T12:00:00");
    expect(isQuietHours(now, "22:00", "08:00")).toBe(false);
  });

  test("returns true at exact start boundary", () => {
    const now = new Date("2025-06-15T22:00:00");
    expect(isQuietHours(now, "22:00", "08:00")).toBe(true);
  });

  test("returns false at exact end boundary", () => {
    const now = new Date("2025-06-15T08:00:00");
    expect(isQuietHours(now, "22:00", "08:00")).toBe(false);
  });

  test("handles non-spanning range (e.g., 01:00–06:00)", () => {
    const now = new Date("2025-06-15T03:00:00");
    expect(isQuietHours(now, "01:00", "06:00")).toBe(true);

    const noon = new Date("2025-06-15T12:00:00");
    expect(isQuietHours(noon, "01:00", "06:00")).toBe(false);
  });

  test("handles minute precision", () => {
    const before = new Date("2025-06-15T22:29:00");
    expect(isQuietHours(before, "22:30", "07:45")).toBe(false);

    const at = new Date("2025-06-15T22:30:00");
    expect(isQuietHours(at, "22:30", "07:45")).toBe(true);
  });
});

// ─── ProactiveScheduler class ───────────────────────────────────

describe("ProactiveScheduler", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  // ─── start / stop ──────────────────────────────────────────

  describe("start/stop", () => {
    test("start() with enabled=false does not set interval", () => {
      const config = createConfig({ enabled: false });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      const origSetInterval = globalThis.setInterval;
      let intervalCalled = false;
      // biome-ignore lint/suspicious/noExplicitAny: monkey-patch setInterval for test
      globalThis.setInterval = ((...args: any[]) => {
        intervalCalled = true;
        return origSetInterval(args[0], args[1]);
      }) as typeof setInterval;

      try {
        scheduler.start();
        expect(intervalCalled).toBe(false);
      } finally {
        globalThis.setInterval = origSetInterval;
      }
    });

    test("stop() sets shuttingDown and clears interval", () => {
      const config = createConfig();
      const scheduler = new ProactiveScheduler(config, asDeps(deps));
      scheduler.start();

      scheduler.stop();

      expect(getPrivate(scheduler, "shuttingDown")).toBe(true);
      expect(getPrivate(scheduler, "intervalHandle")).toBe(null);
    });
  });

  // ─── tick() gates ──────────────────────────────────────────

  describe("tick() gates", () => {
    test("gate 1: queue busy → defers, no performCheck", async () => {
      deps.messageQueue.isProcessing.mockReturnValue(true);
      const config = createConfig({ deferMinutes: 1 });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).not.toHaveBeenCalled();
    });

    test("gate 2: quiet hours → skip", async () => {
      const config = createConfig({ quietHours: { start: "00:00", end: "23:59" } });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).not.toHaveBeenCalled();
    });

    test("gate 3: cooldown active → skip", async () => {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace("Z", "");
      deps.checkInRepo.getLastSentTime.mockReturnValue(tenMinAgo);

      const config = createConfig({ cooldownMinutes: 120 });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).not.toHaveBeenCalled();
    });

    test("gate 4: quiet mode → skip", async () => {
      deps.checkInRepo.isQuietMode.mockReturnValue(true);

      const config = createConfig();
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).not.toHaveBeenCalled();
    });

    test("gate 5: active chat → skip", async () => {
      deps.sessionManager.getLastActivity.mockReturnValue(Date.now() - 60 * 1000);

      const config = createConfig({ deferMinutes: 5 });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).not.toHaveBeenCalled();
    });

    test("all gates open → calls performCheck (acquires lock)", async () => {
      const config = createConfig({ quietHours: { start: "02:00", end: "03:00" } });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).toHaveBeenCalled();
    });
  });

  // ─── performCheck() data phase ────────────────────────────

  describe("performCheck() data handling", () => {
    function createOpenScheduler(configOverrides?: Partial<ProactiveConfig>) {
      const config = createConfig({
        quietHours: { start: "02:00", end: "03:00" },
        ...configOverrides,
      });
      return new ProactiveScheduler(config, asDeps(deps));
    }

    test("all collectors return empty data → skip, no saveLog", async () => {
      deps.collectors[0].collect.mockResolvedValue({ approaching: [] });

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).toHaveBeenCalled();
      expect(deps.checkInRepo.saveLog).not.toHaveBeenCalled();
    });

    test("one collector fails, another works → uses working data", async () => {
      const failingCollector = {
        name: "failing-collector",
        version: "1.0.0",
        type: "custom" as const,
        init: mock(() => Promise.resolve()),
        destroy: mock(() => Promise.resolve()),
        healthCheck: mock(() => Promise.resolve({ healthy: true, lastCheck: new Date() })),
        collect: mock(() => Promise.reject(new Error("boom"))),
      };
      deps.collectors.push(failingCollector);

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      // runGatingQuery was called (through aiEngine.queryStructured)
      expect(deps.aiEngine.queryStructured).toHaveBeenCalled();
    });

    test("data hash matches previous → saveLog with skip/unchanged", async () => {
      const collectedData = {
        "goals-collector": {
          approaching: [{ id: 1, title: "Goal 1", deadline: "2025-07-01", status: "active" }],
        },
      };
      const stable = JSON.stringify(collectedData, (_key, value) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return Object.keys(value)
            .sort()
            .reduce((s: Record<string, unknown>, k) => {
              s[k] = (value as Record<string, unknown>)[k];
              return s;
            }, {});
        }
        return value;
      });
      const expectedHash = new Bun.CryptoHasher("sha256").update(stable).digest("hex");

      deps.checkInRepo.getRecentLogs.mockReturnValue([{ data_hash: expectedHash }]);

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.checkInRepo.saveLog).toHaveBeenCalledWith(
        expect.objectContaining({
          gating_result: "skip",
          skip_reason: "Data unchanged",
        }),
      );
      // queryStructured should NOT be called (short-circuited by hash match)
      expect(deps.aiEngine.queryStructured).not.toHaveBeenCalled();
    });

    test("goal filtering removes reminded goals", async () => {
      deps.collectors[0].collect.mockResolvedValue({
        approaching: [
          { id: 1, title: "Goal 1", deadline: "2025-07-01", status: "active" },
          { id: 2, title: "Goal 2", deadline: "2025-07-02", status: "active" },
          { id: 3, title: "Goal 3", deadline: "2025-07-03", status: "active" },
        ],
      });
      deps.checkInRepo.getRecentlyRemindedGoalIds.mockReturnValue([1, 3]);

      deps.aiEngine.queryStructured.mockResolvedValue({
        action: "text",
        urgency: 5,
        message: "Check your goal",
      });

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      // After filtering, only goal 2 remains
      expect(deps.checkInRepo.markGoalsReminded).toHaveBeenCalledWith([2]);
    });

    test("all data empty after goal filtering → skip without gating query", async () => {
      deps.collectors[0].collect.mockResolvedValue({
        approaching: [{ id: 1, title: "Goal 1", deadline: "2025-07-01", status: "active" }],
      });
      deps.checkInRepo.getRecentlyRemindedGoalIds.mockReturnValue([1]);

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.aiEngine.queryStructured).not.toHaveBeenCalled();
      expect(deps.checkInRepo.saveLog).not.toHaveBeenCalled();
    });
  });

  // ─── performCheck() gating & send phase ───────────────────

  describe("performCheck() gating and delivery", () => {
    function createOpenScheduler(configOverrides?: Partial<ProactiveConfig>) {
      const config = createConfig({
        quietHours: { start: "02:00", end: "03:00" },
        ...configOverrides,
      });
      return new ProactiveScheduler(config, asDeps(deps));
    }

    test("gating=skip → saveLog(skip), no sendMessage", async () => {
      deps.aiEngine.queryStructured.mockResolvedValue({
        action: "skip",
        urgency: 2,
        reason: "Nothing urgent",
      });

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.checkInRepo.saveLog).toHaveBeenCalledWith(
        expect.objectContaining({
          gating_result: "skip",
          skip_reason: "Nothing urgent",
        }),
      );
      expect(deps.messenger.sendMessage).not.toHaveBeenCalled();
    });

    test("gating=text → sendMessage + saveLog(text)", async () => {
      deps.aiEngine.queryStructured.mockResolvedValue({
        action: "text",
        urgency: 5,
        message: "Hey, check your goals!",
      });

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.messenger.sendMessage).toHaveBeenCalledWith(123, "Hey, check your goals!");
      expect(deps.checkInRepo.saveLog).toHaveBeenCalledWith(
        expect.objectContaining({
          gating_result: "text",
          message_sent: "Hey, check your goals!",
          urgency: 5,
        }),
      );
    });

    test("gating=text + urgency >= threshold + Twilio → saveLog(call)", async () => {
      deps.aiEngine.queryStructured.mockResolvedValue({
        action: "text",
        urgency: 8,
        message: "Urgent deadline!",
      });

      const twilioProvider = {
        makeCall: mock(() => Promise.resolve({ callSid: "CA123" })),
      };

      const config = createConfig({
        quietHours: { start: "02:00", end: "03:00" },
        callConfig: {
          enabled: true,
          urgencyThreshold: 7,
          userPhoneNumber: "+1234567890",
        },
      });
      const schedulerDeps = { ...deps, twilioProvider };
      const scheduler = new ProactiveScheduler(config, asDeps(schedulerDeps));

      await tick(scheduler);

      expect(deps.checkInRepo.saveLog).toHaveBeenCalledWith(
        expect.objectContaining({
          gating_result: "call",
          urgency: 8,
        }),
      );
    });

    test("gating=text + high urgency but no Twilio → saveLog(text)", async () => {
      deps.aiEngine.queryStructured.mockResolvedValue({
        action: "text",
        urgency: 10,
        message: "Very urgent!",
      });

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.checkInRepo.saveLog).toHaveBeenCalledWith(
        expect.objectContaining({
          gating_result: "text",
          urgency: 10,
        }),
      );
    });

    test("gating=text → markGoalsReminded called with correct IDs", async () => {
      deps.collectors[0].collect.mockResolvedValue({
        approaching: [
          { id: 5, title: "Goal 5", deadline: "2025-07-01", status: "active" },
          { id: 8, title: "Goal 8", deadline: "2025-07-02", status: "active" },
        ],
      });
      deps.aiEngine.queryStructured.mockResolvedValue({
        action: "text",
        urgency: 4,
        message: "Reminder about your goals",
      });

      const scheduler = createOpenScheduler();
      await tick(scheduler);

      expect(deps.checkInRepo.markGoalsReminded).toHaveBeenCalledWith([5, 8]);
    });
  });

  // ─── Re-entrancy guard ────────────────────────────────────

  describe("re-entrancy", () => {
    test("concurrent tick() calls — second one is no-op", async () => {
      let resolveFirst!: () => void;
      const blockingLock = new Promise<void>((r) => {
        resolveFirst = r;
      });

      deps.messageQueue.acquireQueryLock.mockImplementation(async () => {
        await blockingLock;
        return () => {};
      });

      const config = createConfig({ quietHours: { start: "02:00", end: "03:00" } });
      const scheduler = new ProactiveScheduler(config, asDeps(deps));

      const tick1 = tick(scheduler);
      await new Promise((r) => setTimeout(r, 10));

      await tick(scheduler);

      expect(deps.messageQueue.acquireQueryLock).toHaveBeenCalledTimes(1);

      resolveFirst();
      await tick1;
    });
  });
});
