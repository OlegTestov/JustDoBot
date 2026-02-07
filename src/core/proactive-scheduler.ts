import type { CheckInRepository } from "../plugins/database/sqlite/check-ins";
import type { TwilioCallProvider } from "../plugins/voice/twilio-calls/index";
import { runGatingQuery } from "./gating-query";
import type { IAIEngine, ICollector, IMessenger } from "./interfaces";
import { getLogger } from "./logger";
import type { MessageQueue } from "./message-queue";
import type { SessionManager } from "./session-manager";

export interface TwilioCallConfig {
  enabled: boolean;
  urgencyThreshold: number;
  userPhoneNumber: string;
}

export interface ProactiveConfig {
  enabled: boolean;
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  reminderCooldownMinutes: number;
  deferMinutes: number;
  quietHours: { start: string; end: string };
  targetChatId: number;
  targetUserId: string;
  language: string;
  timezone: string;
  callConfig?: TwilioCallConfig;
}

export class ProactiveScheduler {
  private intervalHandle: Timer | null = null;
  private shuttingDown = false;
  private checking = false;

  constructor(
    private config: ProactiveConfig,
    private deps: {
      collectors: ICollector[];
      checkInRepo: CheckInRepository;
      aiEngine: IAIEngine;
      messenger: IMessenger;
      messageQueue: MessageQueue;
      sessionManager: SessionManager;
      twilioProvider?: TwilioCallProvider;
    },
  ) {}

  start(): void {
    if (!this.config.enabled) {
      getLogger().info("Proactive check-ins disabled");
      return;
    }

    const intervalMs = this.config.checkIntervalMinutes * 60 * 1000;
    this.intervalHandle = setInterval(() => this.tick(), intervalMs);
    getLogger().info(
      { intervalMinutes: this.config.checkIntervalMinutes },
      "Proactive scheduler started",
    );
  }

  stop(): void {
    this.shuttingDown = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      getLogger().info("Proactive scheduler stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.checking) return;
    const logger = getLogger();

    // ─── Hard Gate 1: MessageQueue processing (DEFER, not SKIP) ─
    if (this.deps.messageQueue.isProcessing()) {
      logger.debug("Proactive tick: message queue busy, deferring");
      setTimeout(() => this.tick(), this.config.deferMinutes * 60 * 1000);
      return;
    }

    // ─── Hard Gate 2: Quiet hours ──────────────────────────────
    if (this.isQuietHours()) {
      logger.debug("Proactive tick: quiet hours, skipping");
      return;
    }

    // ─── Hard Gate 3: Cooldown (only sent messages) ────────────
    const lastSent = this.deps.checkInRepo.getLastSentTime();
    if (lastSent) {
      const minsSince = (Date.now() - new Date(`${lastSent}Z`).getTime()) / (1000 * 60);
      if (minsSince < this.config.cooldownMinutes) {
        logger.debug({ minsSince }, "Proactive tick: cooldown active, skipping");
        return;
      }
    }

    // ─── Hard Gate 4: Quiet mode (per-user) ────────────────────
    if (this.deps.checkInRepo.isQuietMode(this.config.targetUserId)) {
      logger.debug("Proactive tick: user in quiet mode, skipping");
      return;
    }

    // ─── Hard Gate 5: Active chat (last activity < deferMinutes) ────
    const lastActivity = this.deps.sessionManager.getLastActivity(this.config.targetChatId);
    if (lastActivity && Date.now() - lastActivity < this.config.deferMinutes * 60 * 1000) {
      logger.debug(
        { minsSince: (Date.now() - lastActivity) / 60000 },
        "Proactive tick: active chat, skipping",
      );
      return;
    }

    // All gates passed — acquire lock and proceed
    this.checking = true;
    try {
      await this.performCheck();
    } finally {
      this.checking = false;
    }
  }

  private async performCheck(): Promise<void> {
    const logger = getLogger();

    const release = await this.deps.messageQueue.acquireQueryLock();
    try {
      // ─── Collect data from all collectors (parallel) ──────────
      const collectedData: Record<string, unknown> = {};
      const sources: string[] = [];

      const results = await Promise.allSettled(this.deps.collectors.map((c) => c.collect()));

      for (let i = 0; i < this.deps.collectors.length; i++) {
        const result = results[i];
        const collector = this.deps.collectors[i];
        if (result.status === "fulfilled") {
          collectedData[collector.name] = result.value;
          sources.push(collector.name);
        } else {
          logger.warn({ err: result.reason, collector: collector.name }, "Collector failed");
        }
      }

      // ─── Empty data guard ─────────────────────────────────────
      const allEmpty = Object.values(collectedData).every((data) => {
        if (Array.isArray(data)) return data.length === 0;
        if (typeof data === "object" && data !== null) {
          return Object.values(data as Record<string, unknown>).every(
            (v) => Array.isArray(v) && v.length === 0,
          );
        }
        return !data;
      });

      if (allEmpty) {
        logger.debug("All collectors returned empty data — skipping");
        return;
      }

      // ─── Hash comparison (on raw data, before filtering) ──────
      const dataHash = this.hashData(collectedData);
      const recentLogs = this.deps.checkInRepo.getRecentLogs(1);
      if (recentLogs.length > 0 && recentLogs[0].data_hash === dataHash) {
        logger.info("Data unchanged — skipping check-in");
        this.deps.checkInRepo.saveLog({
          user_id: this.config.targetUserId,
          data_hash: dataHash,
          sources,
          gating_result: "skip",
          skip_reason: "Data unchanged",
        });
        return;
      }

      // ─── Filter recently-reminded goals ────────────────────────
      let approachingGoalIds: number[] = [];
      if (this.config.reminderCooldownMinutes > 0) {
        const remindedIds = new Set(
          this.deps.checkInRepo.getRecentlyRemindedGoalIds(this.config.reminderCooldownMinutes),
        );
        const goalsData = collectedData["goals-collector"] as
          | { approaching?: Array<{ id: number; title: string; deadline: string; status: string }> }
          | undefined;
        if (goalsData?.approaching) {
          const before = goalsData.approaching.length;
          goalsData.approaching = goalsData.approaching.filter((g) => !remindedIds.has(g.id));
          approachingGoalIds = goalsData.approaching.map((g) => g.id);
          const filtered = before - goalsData.approaching.length;
          if (filtered > 0) {
            logger.debug(
              { filtered, remaining: goalsData.approaching.length },
              "Filtered recently-reminded goals",
            );
          }
        }
      }

      // ─── Re-check empty after filtering ─────────────────────────
      const allEmptyAfterFilter = Object.values(collectedData).every((data) => {
        if (Array.isArray(data)) return data.length === 0;
        if (typeof data === "object" && data !== null) {
          return Object.values(data as Record<string, unknown>).every(
            (v) => Array.isArray(v) && v.length === 0,
          );
        }
        return !data;
      });

      if (allEmptyAfterFilter) {
        logger.debug("All data empty after filtering reminded goals — skipping");
        return;
      }

      // ─── Gating query ─────────────────────────────────────────
      const recentCheckIns = this.deps.checkInRepo.getRecentLogs(3);
      const hasTwilio = !!(this.deps.twilioProvider && this.config.callConfig?.enabled);
      const gatingResult = await runGatingQuery(
        this.deps.aiEngine,
        collectedData,
        recentCheckIns,
        this.config.language,
        this.config.timezone,
        hasTwilio,
      );

      if (gatingResult.action === "skip") {
        logger.info({ reason: gatingResult.reason }, "Gating query: skip");
        this.deps.checkInRepo.saveLog({
          user_id: this.config.targetUserId,
          data_hash: dataHash,
          sources,
          gating_result: "skip",
          skip_reason: gatingResult.reason,
          urgency: gatingResult.urgency,
        });
        return;
      }

      // ─── Send message ─────────────────────────────────────────
      const message = gatingResult.message ?? "Check-in notification";
      await this.deps.messenger.sendMessage(this.config.targetChatId, message);
      logger.info({ urgency: gatingResult.urgency }, "Proactive message sent");

      // ─── Decide if phone call needed ────────────────────────
      let shouldCall = false;
      const cc = this.config.callConfig;
      if (hasTwilio && cc?.userPhoneNumber) {
        shouldCall =
          gatingResult.action === "call" ||
          (gatingResult.action === "text" && gatingResult.urgency >= cc.urgencyThreshold);
      }

      // Log immediately (under lock) — record intent, not network result
      this.deps.checkInRepo.saveLog({
        user_id: this.config.targetUserId,
        data_hash: dataHash,
        sources,
        gating_result: shouldCall ? "call" : "text",
        urgency: gatingResult.urgency,
        message_sent: message,
      });

      // ─── Mark goals as reminded ──────────────────────────────
      if (approachingGoalIds.length > 0) {
        this.deps.checkInRepo.markGoalsReminded(approachingGoalIds);
        logger.debug({ goalIds: approachingGoalIds }, "Marked goals as reminded");
      }

      // ─── Phone call (fire-and-forget AFTER lock release) ───
      if (shouldCall && cc) {
        // Capture values before lock release; call happens outside try/finally
        const callMessage = message;
        const callLanguage = this.config.language;
        const callUrgency = gatingResult.urgency;
        queueMicrotask(() => {
          this.deps
            .twilioProvider!.makeCall(cc.userPhoneNumber, callMessage, callLanguage)
            .then((result) => {
              logger.info(
                { callSid: result.callSid, urgency: callUrgency },
                "Proactive phone call initiated",
              );
            })
            .catch((callErr) => {
              logger.error({ err: callErr }, "Proactive phone call failed");
            });
        });
      }
    } catch (err) {
      logger.error({ err }, "Proactive check failed");
    } finally {
      release();
    }
  }

  private hashData(data: unknown): string {
    const stable = JSON.stringify(data, (_key, value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value)
          .sort()
          .reduce((sorted: Record<string, unknown>, k) => {
            sorted[k] = (value as Record<string, unknown>)[k];
            return sorted;
          }, {});
      }
      return value;
    });
    return new Bun.CryptoHasher("sha256").update(stable).digest("hex");
  }

  private isQuietHours(): boolean {
    return isQuietHours(
      new Date(),
      this.config.quietHours.start,
      this.config.quietHours.end,
      this.config.timezone,
    );
  }
}

/** Pure function for testability — extracted from class. */
export function isQuietHours(now: Date, start: string, end: string, timezone = "UTC"): boolean {
  const [startH, startM = 0] = start.split(":").map(Number);
  const [endH, endM = 0] = end.split(":").map(Number);

  // Get current hours/minutes in user's timezone
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const nowH = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const nowM = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const currentMin = nowH * 60 + nowM;

  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  if (startMin > endMin) {
    // Midnight-spanning: e.g. 22:00-08:00
    return currentMin >= startMin || currentMin < endMin;
  }
  return currentMin >= startMin && currentMin < endMin;
}
