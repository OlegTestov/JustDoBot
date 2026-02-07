import type { HealthStatus, IPlugin, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export class TwilioCallProvider implements IPlugin {
  name = "twilio-calls";
  version = "1.0.0";
  private accountSid = "";
  private authToken = "";
  private phoneNumber = "";
  private logger = getLogger();

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as { voice: { twilio: { phone_number: string } } };
    this.accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
    this.phoneNumber = cfg.voice?.twilio?.phone_number || process.env.TWILIO_PHONE_NUMBER || "";

    if (!this.accountSid) {
      throw new Error("TWILIO_ACCOUNT_SID is not set.");
    }
    if (!this.authToken) {
      throw new Error("TWILIO_AUTH_TOKEN is not set.");
    }
    if (!this.phoneNumber) {
      throw new Error("TWILIO_PHONE_NUMBER is not set.");
    }
    this.logger.info("Twilio call provider initialized");
  }

  async makeCall(
    to: string,
    message: string,
    language = "en",
  ): Promise<{ callSid: string; status: string }> {
    const voiceMap: Record<string, string> = {
      en: "Polly.Joanna",
      ru: "Polly.Tatyana",
      de: "Polly.Marlene",
      es: "Polly.Conchita",
      fr: "Polly.Celine",
      it: "Polly.Carla",
      ja: "Polly.Mizuki",
      ko: "Polly.Seoyeon",
      pt: "Polly.Vitoria",
      zh: "Polly.Zhiyu",
    };

    const voice = voiceMap[language] ?? voiceMap.en;
    const escapedMessage = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    const twiml = `<Response><Say voice="${voice}" language="${language}">${escapedMessage}</Say></Response>`;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
    const authHeader = `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`;

    const body = new URLSearchParams({
      To: to,
      From: this.phoneNumber,
      Twiml: twiml,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Twilio API error ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as { sid: string; status: string };
    this.logger.info({ callSid: result.sid, to }, "Twilio call initiated");
    return { callSid: result.sid, status: result.status };
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: !!(this.accountSid && this.authToken && this.phoneNumber),
      lastCheck: new Date(),
      message: this.accountSid ? undefined : "Twilio not configured",
    };
  }
}
