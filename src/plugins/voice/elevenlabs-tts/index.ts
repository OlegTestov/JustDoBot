import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { HealthStatus, ITTSProvider, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export class ElevenLabsTTSProvider implements ITTSProvider {
  name = "elevenlabs-tts";
  version = "1.0.0";
  private client!: ElevenLabsClient;
  private voiceId = "";
  private modelId = "eleven_multilingual_v2";
  private logger = getLogger();

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as { voice: { tts: { voice_id: string; model: string } } };
    const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Required when voice.tts.type: elevenlabs. " +
          "Add it to .env or switch to gemini TTS in config.yaml.",
      );
    }
    this.voiceId = cfg.voice?.tts?.voice_id || process.env.ELEVENLABS_VOICE_ID || "";
    if (!this.voiceId) {
      throw new Error(
        "ELEVENLABS_VOICE_ID is not set. Configure voice.tts.voice_id or ELEVENLABS_VOICE_ID env var.",
      );
    }
    this.modelId = cfg.voice?.tts?.model ?? "eleven_multilingual_v2";
    this.client = new ElevenLabsClient({ apiKey });
    this.logger.info({ voiceId: this.voiceId, model: this.modelId }, "ElevenLabs TTS initialized");
  }

  async synthesize(text: string): Promise<Buffer> {
    // ogg_opus is supported by ElevenLabs API but not listed in SDK types
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const audioStream = await this.client.textToSpeech.convert(
        this.voiceId,
        {
          text,
          modelId: this.modelId,
          outputFormat: "ogg_opus" as "mp3_44100_128",
        },
        { abortSignal: controller.signal },
      );

      const chunks: Uint8Array[] = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      this.logger.debug({ bytes: buffer.length, chars: text.length }, "ElevenLabs TTS complete");
      return buffer;
    } finally {
      clearTimeout(timeout);
    }
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: !!(this.voiceId && this.client),
      lastCheck: new Date(),
      message: this.voiceId ? undefined : "No voice ID configured",
    };
  }
}
