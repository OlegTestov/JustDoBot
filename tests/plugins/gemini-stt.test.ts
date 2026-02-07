import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GeminiSTTProvider } from "../../src/plugins/voice/gemini-stt/index";

let provider: GeminiSTTProvider;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  provider = new GeminiSTTProvider();
  originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
});

describe("GeminiSTTProvider", () => {
  describe("init", () => {
    test("throws without GEMINI_API_KEY", async () => {
      delete process.env.GEMINI_API_KEY;
      await expect(
        provider.init({ voice: { stt: { model: "gemini-2.5-flash" } } }),
      ).rejects.toThrow("GEMINI_API_KEY is not set");
    });

    test("succeeds with API key", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      await expect(
        provider.init({ voice: { stt: { model: "gemini-2.5-flash" } } }),
      ).resolves.toBeUndefined();
    });
  });

  describe("transcribe", () => {
    test("sends correct request and returns text", async () => {
      await provider.init({ voice: { stt: { model: "gemini-2.5-flash" } } });

      const audioBuffer = Buffer.from("fake-audio-data");
      const expectedBase64 = audioBuffer.toString("base64");

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        expect(urlStr).toContain("gemini-2.5-flash");
        expect(urlStr).toContain("generateContent");
        expect(urlStr).not.toContain("key=");
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

        const body = JSON.parse(init?.body as string);
        expect(body.contents[0].parts[0].inlineData.mimeType).toBe("audio/ogg");
        expect(body.contents[0].parts[0].inlineData.data).toBe(expectedBase64);

        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const result = await provider.transcribe(audioBuffer, "oga");
      expect(result).toBe("Hello world");
    });

    test("throws on API error", async () => {
      await provider.init({ voice: { stt: { model: "gemini-2.5-flash" } } });

      globalThis.fetch = (async () => {
        return new Response("Internal Server Error", { status: 500 });
      }) as typeof fetch;

      await expect(provider.transcribe(Buffer.from("audio"), "oga")).rejects.toThrow(
        "Gemini STT error 500",
      );
    });

    test("throws on empty response", async () => {
      await provider.init({ voice: { stt: { model: "gemini-2.5-flash" } } });

      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      await expect(provider.transcribe(Buffer.from("audio"), "oga")).rejects.toThrow(
        "Gemini STT returned empty transcription",
      );
    });
  });

  describe("getMimeType", () => {
    test("maps formats correctly", () => {
      // Access private method via cast for unit testing
      const p = provider as unknown as { getMimeType(f: string): string };
      expect(p.getMimeType("oga")).toBe("audio/ogg");
      expect(p.getMimeType("mp3")).toBe("audio/mpeg");
      expect(p.getMimeType("wav")).toBe("audio/wav");
      expect(p.getMimeType("m4a")).toBe("audio/mp4");
      expect(p.getMimeType("unknown")).toBe("audio/unknown");
    });
  });
});
