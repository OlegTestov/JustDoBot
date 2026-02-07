import type { HealthStatus, ICollector, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";
import { CalendarClient } from "./calendar";
import { GmailClient } from "./gmail";
import { GoogleOAuthClient } from "./oauth";

export interface CollectedData {
  gmail: Array<{ subject: string; from: string; snippet: string; date: string }>;
  calendar: Array<{ summary: string; start: string; end: string; location?: string }>;
}

export class GoogleCollectorProvider implements ICollector {
  name = "google-collector";
  version = "1.0.0";
  type = "custom" as const;

  private oauth!: GoogleOAuthClient;
  private gmail!: GmailClient;
  private calendar!: CalendarClient;
  private gmailEnabled = false;
  private calendarEnabled = false;
  private initialized = false;

  async init(config: PluginConfig): Promise<void> {
    const google = (config as Record<string, unknown>)?.collectors as
      | Record<string, unknown>
      | undefined;
    const gcfg = google?.google as
      | {
          client_id?: string;
          client_secret?: string;
          gmail?: { enabled: boolean };
          calendar?: { enabled: boolean };
        }
      | undefined;

    if (!gcfg?.client_id || !gcfg?.client_secret) {
      getLogger().info("Google collector: no config found — disabled");
      return;
    }

    this.gmailEnabled = gcfg.gmail?.enabled ?? false;
    this.calendarEnabled = gcfg.calendar?.enabled ?? false;

    this.oauth = new GoogleOAuthClient({
      clientId: gcfg.client_id,
      clientSecret: gcfg.client_secret,
      redirectUri: "http://localhost:3000/oauth/callback",
      tokenPath: "./data/google-tokens.json",
    });

    try {
      await this.oauth.init();
      this.gmail = new GmailClient(this.oauth);
      this.calendar = new CalendarClient(this.oauth);
      this.initialized = true;
      getLogger().info("Google collector initialized");
    } catch (err) {
      getLogger().warn(
        { err },
        "Google OAuth not configured — collector disabled. Run: bun run web-setup → Step 4 → Connect Google",
      );
      this.gmailEnabled = false;
      this.calendarEnabled = false;
    }
  }

  async collect(): Promise<CollectedData> {
    const data: CollectedData = { gmail: [], calendar: [] };

    if (!this.initialized) return data;

    if (this.gmailEnabled) {
      try {
        const messages = await this.gmail.getImportantUnread(7);
        data.gmail = messages.map((m) => ({
          subject: m.subject,
          from: m.from,
          snippet: m.snippet,
          date: m.date,
        }));
      } catch (err) {
        getLogger().warn({ err }, "Gmail collection failed");
      }
    }

    if (this.calendarEnabled) {
      try {
        const events = await this.calendar.getUpcomingEvents(2);
        data.calendar = events.map((e) => ({
          summary: e.summary,
          start: e.start,
          end: e.end,
          location: e.location,
        }));
      } catch (err) {
        getLogger().warn({ err }, "Calendar collection failed");
      }
    }

    return data;
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return { healthy: false, message: "OAuth not initialized", lastCheck: new Date() };
    }
    try {
      await this.oauth.getAccessToken();
      return { healthy: true, lastCheck: new Date() };
    } catch (err) {
      return { healthy: false, message: String(err), lastCheck: new Date() };
    }
  }
}
