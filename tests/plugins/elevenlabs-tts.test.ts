import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ElevenLabsTTSProvider } from "../../src/plugins/voice/elevenlabs-tts/index";

let provider: ElevenLabsTTSProvider;

beforeEach(() => {
  provider = new ElevenLabsTTSProvider();
  process.env.ELEVENLABS_API_KEY = "test-api-key";
  process.env.ELEVENLABS_VOICE_ID = "test-voice-id";
});

afterEach(() => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
});

describe("ElevenLabsTTSProvider", () => {
  describe("init", () => {
    test("throws without API key", async () => {
      delete process.env.ELEVENLABS_API_KEY;
      await expect(
        provider.init({
          voice: { tts: { voice_id: "test-voice", model: "eleven_multilingual_v2" } },
        }),
      ).rejects.toThrow("ELEVENLABS_API_KEY is not set");
    });

    test("throws without voice ID", async () => {
      process.env.ELEVENLABS_API_KEY = "test-api-key";
      delete process.env.ELEVENLABS_VOICE_ID;
      await expect(
        provider.init({ voice: { tts: { voice_id: "", model: "eleven_multilingual_v2" } } }),
      ).rejects.toThrow("ELEVENLABS_VOICE_ID is not set");
    });

    test("succeeds with all config", async () => {
      await expect(
        provider.init({
          voice: { tts: { voice_id: "test-voice", model: "eleven_multilingual_v2" } },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("synthesize", () => {
    test("collects stream and returns buffer", async () => {
      await provider.init({
        voice: { tts: { voice_id: "test-voice", model: "eleven_multilingual_v2" } },
      });

      // Mock the ElevenLabs client's textToSpeech.convert method
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);

      // biome-ignore lint/suspicious/noExplicitAny: access private field in test
      (provider as any).client = {
        textToSpeech: {
          convert: async function* () {
            yield chunk1;
            yield chunk2;
          },
        },
      };

      const result = await provider.synthesize("Hello world");
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(6);
      expect(result[0]).toBe(1);
      expect(result[3]).toBe(4);
      expect(result[5]).toBe(6);
    });
  });

  describe("healthCheck", () => {
    test("returns healthy when configured", async () => {
      await provider.init({
        voice: { tts: { voice_id: "test-voice", model: "eleven_multilingual_v2" } },
      });

      const status = await provider.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.lastCheck).toBeInstanceOf(Date);
      expect(status.message).toBeUndefined();
    });
  });
});
