import type { HealthStatus, ITTSProvider, PluginConfig } from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export class GeminiTTSProvider implements ITTSProvider {
  name = "gemini-tts";
  version = "1.0.0";
  private apiKey = "";
  private voiceName = "Kore";
  private model = "gemini-2.5-flash-preview-tts";
  private logger = getLogger();

  async init(config: PluginConfig): Promise<void> {
    const cfg = config as { voice: { tts: { voice_name: string; gemini_model: string } } };
    this.apiKey = process.env.GEMINI_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Required when voice.tts.type: gemini. " +
          "Add it to .env or switch to elevenlabs TTS in config.yaml.",
      );
    }
    this.voiceName = cfg.voice?.tts?.voice_name ?? "Kore";
    this.model = cfg.voice?.tts?.gemini_model ?? "gemini-2.5-flash-preview-tts";

    // Check ffmpeg availability (required for PCM → OGG conversion)
    try {
      const proc = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) throw new Error(`ffmpeg exit code: ${proc.exitCode}`);
    } catch {
      throw new Error(
        "ffmpeg is required for Gemini TTS (PCM → OGG conversion). " +
          "Install: apt-get install ffmpeg / brew install ffmpeg",
      );
    }

    this.logger.info({ voice: this.voiceName, model: this.model }, "Gemini TTS initialized");
  }

  async synthesize(text: string): Promise<Buffer> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.voiceName },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini TTS error ${response.status}: ${error}`);
    }

    const result = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data: string } }> };
      }>;
    };
    const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Gemini TTS returned no audio data");

    const pcmBuffer = Buffer.from(base64Audio, "base64");
    const oggBuffer = await this.convertPcmToOgg(pcmBuffer);
    this.logger.debug(
      { pcmBytes: pcmBuffer.length, oggBytes: oggBuffer.length },
      "Gemini TTS complete",
    );
    return oggBuffer;
  }

  private async convertPcmToOgg(pcm: Buffer): Promise<Buffer> {
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-f",
        "s16le",
        "-ar",
        "24000",
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-c:a",
        "libopus",
        "-b:a",
        "64k",
        "-f",
        "ogg",
        "pipe:1",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    proc.stdin.write(pcm);
    proc.stdin.end();

    const result = await new Response(proc.stdout).arrayBuffer();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ffmpeg conversion failed (exit ${exitCode}): ${stderr}`);
    }
    return Buffer.from(result);
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
