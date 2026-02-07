import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { GeminiTTSProvider } from "../../src/plugins/voice/gemini-tts/index";

let provider: GeminiTTSProvider;
let originalFetch: typeof globalThis.fetch;
let spawnSpy: Mock<typeof Bun.spawn>;

beforeEach(() => {
  provider = new GeminiTTSProvider();
  originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  if (spawnSpy) spawnSpy.mockRestore();
});

/**
 * Helper to create a mock Bun.spawn process that resolves immediately.
 * exitCode controls success/failure; stdout provides output data.
 */
function mockSpawnResult(exitCode: number, stdout?: Uint8Array) {
  const stdoutStream = stdout
    ? new ReadableStream({
        start(controller) {
          controller.enqueue(stdout);
          controller.close();
        },
      })
    : new ReadableStream({
        start(c) {
          c.close();
        },
      });

  const stderrStream = new ReadableStream({
    start(controller) {
      if (exitCode !== 0) controller.enqueue(new TextEncoder().encode("ffmpeg error"));
      controller.close();
    },
  });

  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    stdin: {
      write: () => {},
      end: () => {},
    },
    exited: Promise.resolve(exitCode),
    exitCode,
    pid: 12345,
    kill: () => {},
    killed: false,
    ref: () => {},
    unref: () => {},
    resourceUsage: () => undefined,
    signalCode: null,
  };
}

describe("GeminiTTSProvider", () => {
  describe("init", () => {
    test("throws without GEMINI_API_KEY", async () => {
      delete process.env.GEMINI_API_KEY;
      // Mock spawn so ffmpeg check is never the reason for failure
      spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mock Subprocess
        mockSpawnResult(0) as any,
      );
      await expect(
        provider.init({
          voice: { tts: { voice_name: "Kore", gemini_model: "gemini-2.5-flash-preview-tts" } },
        }),
      ).rejects.toThrow("GEMINI_API_KEY is not set");
    });

    test("throws without ffmpeg", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn failed");
      });

      await expect(
        provider.init({
          voice: { tts: { voice_name: "Kore", gemini_model: "gemini-2.5-flash-preview-tts" } },
        }),
      ).rejects.toThrow("ffmpeg is required");
    });

    test("succeeds with API key and ffmpeg", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mock Subprocess
        mockSpawnResult(0) as any,
      );

      await expect(
        provider.init({
          voice: { tts: { voice_name: "Kore", gemini_model: "gemini-2.5-flash-preview-tts" } },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("synthesize", () => {
    test("calls Gemini API and converts PCM to OGG", async () => {
      // Mock spawn for init (ffmpeg -version check)
      spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mock Subprocess
        mockSpawnResult(0) as any,
      );
      await provider.init({
        voice: { tts: { voice_name: "Kore", gemini_model: "gemini-2.5-flash-preview-tts" } },
      });

      // Prepare fake PCM audio data (base64-encoded)
      const fakePcmData = Buffer.from("fake-pcm-audio-data");
      const base64Pcm = fakePcmData.toString("base64");

      // Mock fetch to return Gemini TTS response with base64 audio
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        expect(urlStr).toContain("generateContent");
        expect(urlStr).not.toContain("key=");
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

        const body = JSON.parse(init?.body as string);
        expect(body.contents[0].parts[0].text).toBe("Hello world");
        expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { data: base64Pcm } }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      // Mock spawn for ffmpeg PCM-to-OGG conversion (called by convertPcmToOgg)
      const fakeOggOutput = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // OGG magic bytes
      // biome-ignore lint/suspicious/noExplicitAny: mock Subprocess
      spawnSpy.mockReturnValue(mockSpawnResult(0, fakeOggOutput) as any);

      const result = await provider.synthesize("Hello world");
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(fakeOggOutput.length);
      expect(result[0]).toBe(0x4f); // 'O' in OGG header
    });
  });

  describe("healthCheck", () => {
    test("returns healthy when configured", async () => {
      spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mock Subprocess
        mockSpawnResult(0) as any,
      );
      await provider.init({
        voice: { tts: { voice_name: "Kore", gemini_model: "gemini-2.5-flash-preview-tts" } },
      });

      const status = await provider.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.lastCheck).toBeInstanceOf(Date);
      expect(status.message).toBeUndefined();
    });
  });
});
