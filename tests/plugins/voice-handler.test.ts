import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Bot } from "grammy";
import type { ISTTProvider, MessageHandler } from "../../src/core/interfaces";
import { registerVoiceHandler } from "../../src/plugins/messengers/telegram/handlers/voice";

// ─── Mock helpers ────────────────────────────────────────────────

function createMockBot() {
  const handlers: Record<string, (...args: never[]) => unknown> = {};
  return {
    on: mock((event: string, handler: (...args: never[]) => unknown) => {
      handlers[event] = handler;
    }),
    _trigger: async (event: string, ctx: unknown) => {
      if (handlers[event]) await handlers[event](ctx);
    },
    _handlers: handlers,
  };
}

function createMockSTT(result = "transcribed text"): ISTTProvider {
  return {
    name: "mock-stt",
    version: "1.0.0",
    init: mock(() => Promise.resolve()),
    destroy: mock(() => Promise.resolve()),
    healthCheck: mock(() => Promise.resolve({ healthy: true, lastCheck: new Date() })),
    transcribe: mock(() => Promise.resolve(result)),
  };
}

function createMockVoiceCtx(filePath = "voice/file.oga") {
  return {
    message: {
      voice: { file_id: "file123", duration: 5, mime_type: "audio/ogg" },
      message_id: 42,
    },
    chat: { id: 123, type: "private" },
    from: { id: 456 },
    api: {
      getFile: mock(() => Promise.resolve({ file_path: filePath })),
      token: "test-token",
    },
    reply: mock(() => Promise.resolve()),
  };
}

function createMockAudioCtx(filePath = "audio/song.mp3", mimeType = "audio/mpeg") {
  return {
    message: {
      audio: { file_id: "audio456", duration: 120, mime_type: mimeType },
      message_id: 99,
    },
    chat: { id: 789, type: "private" },
    from: { id: 111 },
    api: {
      getFile: mock(() => Promise.resolve({ file_path: filePath })),
      token: "test-token",
    },
    reply: mock(() => Promise.resolve()),
  };
}

const mockTranslator = (key: string) => key;

// ─── Global fetch mock ──────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    } as Response),
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ──────────────────────────────────────────────────────

describe("registerVoiceHandler", () => {
  test("registers voice and audio handlers", () => {
    const bot = createMockBot();
    const handler = mock(() => Promise.resolve()) as unknown as MessageHandler;
    const stt = createMockSTT();

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    expect(bot.on).toHaveBeenCalledTimes(2);
    expect(bot._handlers["message:voice"]).toBeDefined();
    expect(bot._handlers["message:audio"]).toBeDefined();
  });

  test("voice: downloads, transcribes, and calls handler", async () => {
    const bot = createMockBot();
    const handlerMock = mock(() => Promise.resolve());
    const handler = handlerMock as unknown as MessageHandler;
    const stt = createMockSTT("Hello from voice");

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    const ctx = createMockVoiceCtx();
    await bot._trigger("message:voice", ctx);

    // Verify file was fetched
    expect(ctx.api.getFile).toHaveBeenCalledWith("file123");
    expect(globalThis.fetch).toHaveBeenCalled();

    // Verify transcribing feedback + transcription
    expect(ctx.reply).toHaveBeenCalledWith("voice.transcribing");
    expect(stt.transcribe).toHaveBeenCalledTimes(1);

    // Verify handler called with correct arguments
    expect(handler).toHaveBeenCalledTimes(1);
    const call = handlerMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.chatId).toBe(123);
    expect(call.userId).toBe(456);
    expect(call.text).toBe("Hello from voice");
    expect(call.messageId).toBe(42);
    expect(call.chatType).toBe("private");
    expect(call.voice).toBeDefined();
    const voice = call.voice as Record<string, unknown>;
    expect(voice.duration).toBe(5);
    expect(voice.mimeType).toBe("audio/ogg");
  });

  test("voice: passes correct format", async () => {
    const bot = createMockBot();
    const handler = mock(() => Promise.resolve()) as unknown as MessageHandler;
    const stt = createMockSTT();
    const transcribeMock = stt.transcribe as ReturnType<typeof mock>;

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    const ctx = createMockVoiceCtx("voice/recording.oga");
    await bot._trigger("message:voice", ctx);

    // The format is extracted from file_path: "voice/recording.oga" -> "oga"
    const transcribeCall = transcribeMock.mock.calls[0];
    expect(transcribeCall[1]).toBe("oga");
  });

  test("voice: sends error on transcription failure", async () => {
    const bot = createMockBot();
    const handler = mock(() => Promise.resolve()) as unknown as MessageHandler;
    const stt = createMockSTT();
    const transcribeMock = stt.transcribe as ReturnType<typeof mock>;
    transcribeMock.mockImplementation(() => {
      throw new Error("STT service unavailable");
    });

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    const ctx = createMockVoiceCtx();
    await bot._trigger("message:voice", ctx);

    expect(ctx.reply).toHaveBeenCalledWith("voice.error");
    expect(handler).not.toHaveBeenCalled();
  });

  test("audio: downloads, transcribes, and calls handler", async () => {
    const bot = createMockBot();
    const handlerMock = mock(() => Promise.resolve());
    const handler = handlerMock as unknown as MessageHandler;
    const stt = createMockSTT("Audio transcription result");

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    const ctx = createMockAudioCtx();
    await bot._trigger("message:audio", ctx);

    // Verify file was fetched
    expect(ctx.api.getFile).toHaveBeenCalledWith("audio456");
    expect(globalThis.fetch).toHaveBeenCalled();

    // Verify transcribing feedback + transcription
    expect(ctx.reply).toHaveBeenCalledWith("voice.transcribing");
    expect(stt.transcribe).toHaveBeenCalledTimes(1);

    // Verify handler called with correct arguments
    expect(handler).toHaveBeenCalledTimes(1);
    const call = handlerMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.chatId).toBe(789);
    expect(call.userId).toBe(111);
    expect(call.text).toBe("Audio transcription result");
    expect(call.messageId).toBe(99);
    expect(call.chatType).toBe("private");
    expect(call.voice).toBeDefined();
    const voice = call.voice as Record<string, unknown>;
    expect(voice.duration).toBe(120);
    expect(voice.mimeType).toBe("audio/mpeg");
  });

  test("audio: extracts format from mime_type", async () => {
    const bot = createMockBot();
    const handler = mock(() => Promise.resolve()) as unknown as MessageHandler;
    const stt = createMockSTT();
    const transcribeMock = stt.transcribe as ReturnType<typeof mock>;

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    const ctx = createMockAudioCtx("audio/song.mp3", "audio/mpeg");
    await bot._trigger("message:audio", ctx);

    // Format extracted from mime_type "audio/mpeg" -> "mpeg"
    const transcribeCall = transcribeMock.mock.calls[0];
    expect(transcribeCall[1]).toBe("mpeg");
  });

  test("audio: sends error on failure", async () => {
    const bot = createMockBot();
    const handler = mock(() => Promise.resolve()) as unknown as MessageHandler;
    const stt = createMockSTT();
    const transcribeMock = stt.transcribe as ReturnType<typeof mock>;
    transcribeMock.mockImplementation(() => {
      throw new Error("Audio processing failed");
    });

    registerVoiceHandler(bot as unknown as Bot, handler, stt, mockTranslator);

    const ctx = createMockAudioCtx();
    await bot._trigger("message:audio", ctx);

    expect(ctx.reply).toHaveBeenCalledWith("voice.error");
    expect(handler).not.toHaveBeenCalled();
  });
});
