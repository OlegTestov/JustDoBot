import type { HealthStatus, ISTTProvider, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export class GeminiSTTProvider implements ISTTProvider {
  name = "gemini-stt";
  version = "1.0.0";
  private apiKey = "";
  private model = "gemini-2.5-flash";
  private logger = getLogger();

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as { voice: { stt: { model: string } } };
    this.model = cfg.voice?.stt?.model ?? "gemini-2.5-flash";
    this.apiKey = process.env.GEMINI_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Required when voice.stt.enabled: true. " +
          "Add it to .env or disable voice STT in config.yaml.",
      );
    }
    this.logger.info({ model: this.model }, "Gemini STT provider initialized");
  }

  async transcribe(audio: Buffer, format: string): Promise<string> {
    const mimeType = this.getMimeType(format);
    const base64Audio = audio.toString("base64");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType, data: base64Audio } },
                {
                  text: "Transcribe this audio message exactly as spoken. Return only the transcription text, nothing else. No quotes, no labels, no commentary.",
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini STT error ${response.status}: ${error}`);
    }

    const result = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Gemini STT returned empty transcription");

    this.logger.debug({ chars: text.length }, "Transcription complete");
    return text;
  }

  private getMimeType(format: string): string {
    const mimeMap: Record<string, string> = {
      oga: "audio/ogg",
      ogg: "audio/ogg",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      flac: "audio/flac",
      aac: "audio/aac",
    };
    return mimeMap[format.toLowerCase()] ?? `audio/${format}`;
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: !!this.apiKey,
      lastCheck: new Date(),
      message: this.apiKey ? undefined : "No GEMINI_API_KEY configured",
    };
  }
}
