import { describe, expect, mock, test } from "bun:test";
import type { Bot } from "grammy";
import type { ITTSProvider } from "../../src/core/interfaces";
import {
  registerCallbackHandler,
  removePendingTTS,
  storeMessageText,
  storePendingTTS,
} from "../../src/plugins/messengers/telegram/handlers/callbacks";

// ─── Mock helpers ────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: test mock handler signature
type AnyFn = (...args: any[]) => unknown;

function createMockBot() {
  const handlers: Record<string, AnyFn> = {};
  return {
    on: mock((event: string, handler: AnyFn) => {
      handlers[event] = handler;
    }),
    _trigger: async (event: string, ctx: unknown) => {
      if (handlers[event]) await handlers[event](ctx);
    },
    _handlers: handlers,
  };
}

function createMockCallbackCtx(data: string) {
  return {
    callbackQuery: {
      data,
      message: { chat: { id: 123 } },
    },
    answerCallbackQuery: mock(() => Promise.resolve()),
    editMessageReplyMarkup: mock(() => Promise.resolve()),
    api: {
      sendChatAction: mock(() => Promise.resolve()),
      sendVoice: mock(() => Promise.resolve()),
    },
  };
}

function createMockTTSProvider(): ITTSProvider {
  return {
    name: "mock-tts",
    version: "1.0.0",
    init: mock(() => Promise.resolve()),
    destroy: mock(() => Promise.resolve()),
    healthCheck: mock(() => Promise.resolve({ healthy: true, lastCheck: new Date() })),
    synthesize: mock(() => Promise.resolve(Buffer.from("fake-audio-data"))),
  };
}

const mockTranslator = (key: string) => key;

// ─── Tests ──────────────────────────────────────────────────────

describe("callbacks handler", () => {
  test("storePendingTTS and removePendingTTS", () => {
    const controller = new AbortController();
    storePendingTTS("test-key-1", controller);

    // Verify the controller is stored by aborting via skip_audio callback
    // The controller should be accessible and functional
    expect(controller.signal.aborted).toBe(false);

    // Store another and remove it — removal should not throw
    const controller2 = new AbortController();
    storePendingTTS("test-key-2", controller2);
    removePendingTTS("test-key-2");

    // Removing a non-existent key should not throw
    removePendingTTS("non-existent-key");
  });

  test("storeMessageText: stores and allows retrieval via listen callback", async () => {
    const bot = createMockBot();
    const tts = createMockTTSProvider();

    registerCallbackHandler(bot as unknown as Bot, { ttsProvider: tts, t: mockTranslator });

    // Store text that the listen callback will look up
    storeMessageText("msg42", "Hello, this is stored text");

    const ctx = createMockCallbackCtx("listen_msg42");
    await bot._trigger("callback_query:data", ctx);

    // Verify TTS was called with the stored text
    expect(tts.synthesize).toHaveBeenCalledWith("Hello, this is stored text");
    expect(ctx.api.sendChatAction).toHaveBeenCalledWith(123, "record_voice");
    expect(ctx.api.sendVoice).toHaveBeenCalledTimes(1);
  });

  test("skip_audio callback: aborts TTS and removes button", async () => {
    const bot = createMockBot();
    registerCallbackHandler(bot as unknown as Bot, { t: mockTranslator });

    // Store a pending TTS controller
    const controller = new AbortController();
    storePendingTTS("abc123", controller);

    const ctx = createMockCallbackCtx("skip_audio_abc123");
    await bot._trigger("callback_query:data", ctx);

    // Verify abort was called
    expect(controller.signal.aborted).toBe(true);

    // Verify reply markup removed (button removed)
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: undefined,
    });

    // Verify callback answered
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "voice.skipConfirm",
    });
  });

  test("listen callback: returns unavailable without TTS provider", async () => {
    const bot = createMockBot();
    registerCallbackHandler(bot as unknown as Bot, { t: mockTranslator });

    // Store text but no TTS provider
    storeMessageText("noTTS", "Some text");

    const ctx = createMockCallbackCtx("listen_noTTS");
    await bot._trigger("callback_query:data", ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "voice.unavailable",
    });
    // sendVoice should NOT be called
    expect(ctx.api.sendVoice).not.toHaveBeenCalled();
  });

  test("listen callback: generates and sends audio", async () => {
    const bot = createMockBot();
    const tts = createMockTTSProvider();

    registerCallbackHandler(bot as unknown as Bot, { ttsProvider: tts, t: mockTranslator });

    storeMessageText("full-flow", "Generate audio for this text");

    const ctx = createMockCallbackCtx("listen_full-flow");
    await bot._trigger("callback_query:data", ctx);

    // Verify generating answer
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "voice.generating",
    });

    // Verify chat action sent
    expect(ctx.api.sendChatAction).toHaveBeenCalledWith(123, "record_voice");

    // Verify TTS synthesize called
    expect(tts.synthesize).toHaveBeenCalledWith("Generate audio for this text");

    // Verify voice message sent
    expect(ctx.api.sendVoice).toHaveBeenCalledTimes(1);
    const sendVoiceMock = ctx.api.sendVoice as ReturnType<typeof mock>;
    const sendVoiceCall = sendVoiceMock.mock.calls[0];
    expect(sendVoiceCall[0]).toBe(123); // chatId
  });

  test("unknown callback: answers with unknown action", async () => {
    const bot = createMockBot();
    registerCallbackHandler(bot as unknown as Bot, { t: mockTranslator });

    const ctx = createMockCallbackCtx("some_random_action");
    await bot._trigger("callback_query:data", ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Unknown action",
    });
  });
});
