import type { Api } from "grammy";
import { getLogger } from "../../../core/logger";
import { splitMessage } from "../../../core/message-splitter";
import { markdownToTelegramHtml } from "../../../core/safe-markdown";
import type { Translator } from "../../../locales";

export class StreamingResponseHandler {
  private api: Api;
  private chatId: number;
  private t: Translator;
  private messageId: number | null = null;
  private accumulatedText = "";
  private cancelled = false;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private thinkingTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastEditTime = 0;
  private editDebounceMs: number;
  private thinkingTimeoutMs: number;
  private pendingEdit: ReturnType<typeof setTimeout> | null = null;

  constructor(
    api: Api,
    chatId: number,
    config: { edit_debounce_ms: number; thinking_timeout_ms: number },
    t: Translator,
  ) {
    this.api = api;
    this.chatId = chatId;
    this.editDebounceMs = config.edit_debounce_ms;
    this.thinkingTimeoutMs = config.thinking_timeout_ms;
    this.t = t;
  }

  async start(): Promise<void> {
    // Start typing indicator, repeat every 4s
    try {
      await this.api.sendChatAction(this.chatId, "typing");
    } catch {
      /* ignore */
    }
    this.typingInterval = setInterval(async () => {
      if (this.cancelled) return;
      try {
        await this.api.sendChatAction(this.chatId, "typing");
      } catch {
        /* ignore */
      }
    }, 4000);

    // "Thinking..." message after timeout if no chunk arrives
    this.thinkingTimeout = setTimeout(async () => {
      if (!this.messageId && !this.cancelled) {
        try {
          const sent = await this.api.sendMessage(this.chatId, this.t("streaming.thinking"));
          this.messageId = sent.message_id;
        } catch {
          /* ignore */
        }
      }
    }, this.thinkingTimeoutMs);
  }

  async onTextChunk(text: string): Promise<void> {
    if (this.cancelled) return;
    this.accumulatedText += text;

    // Clear thinking timeout on first chunk
    if (this.thinkingTimeout) {
      clearTimeout(this.thinkingTimeout);
      this.thinkingTimeout = null;
    }

    if (!this.messageId) {
      // First real chunk — send new message or replace "Thinking..."
      if (this.typingInterval) {
        clearInterval(this.typingInterval);
        this.typingInterval = null;
      }
      try {
        const sent = await this.api.sendMessage(this.chatId, this.accumulatedText);
        this.messageId = sent.message_id;
        this.lastEditTime = Date.now();
      } catch (err) {
        getLogger().error({ err }, "Failed to send first chunk");
      }
      return;
    }

    // Subsequent chunks: debounced editMessage
    this.scheduleEdit();
  }

  private scheduleEdit(): void {
    if (this.pendingEdit) return;

    const timeSinceLastEdit = Date.now() - this.lastEditTime;
    const delay = Math.max(0, this.editDebounceMs - timeSinceLastEdit);

    this.pendingEdit = setTimeout(async () => {
      this.pendingEdit = null;
      if (this.cancelled || !this.messageId) return;

      try {
        await this.api.editMessageText(this.chatId, this.messageId, this.accumulatedText);
        this.lastEditTime = Date.now();
      } catch (err) {
        const msg = String(err);
        if (!msg.includes("message is not modified")) {
          getLogger().error({ err }, "Failed to edit message");
        }
      }
    }, delay);
  }

  async finalize(fullText: string): Promise<void> {
    if (this.typingInterval) clearInterval(this.typingInterval);
    if (this.thinkingTimeout) clearTimeout(this.thinkingTimeout);
    if (this.pendingEdit) clearTimeout(this.pendingEdit);

    if (this.cancelled) return;
    if (!fullText) {
      // No text to show (tool-only response) — delete the "Thinking..." message if any
      if (this.messageId) {
        try {
          await this.api.deleteMessage(this.chatId, this.messageId);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    const parts = splitMessage(fullText);

    if (this.messageId && parts.length > 0) {
      // Try HTML (converted from Markdown), fallback to plain text
      try {
        const html = markdownToTelegramHtml(parts[0]);
        await this.api.editMessageText(this.chatId, this.messageId, html, { parse_mode: "HTML" });
      } catch (htmlErr) {
        // "message is not modified" means streaming already sent the final text — OK
        const htmlMsg = String(htmlErr);
        if (htmlMsg.includes("message is not modified")) return;
        // HTML parse failed — fallback to plain text
        try {
          await this.api.editMessageText(this.chatId, this.messageId, parts[0]);
        } catch (err) {
          const errMsg = String(err);
          if (!errMsg.includes("message is not modified")) {
            getLogger().error({ err }, "Failed to finalize first part");
          }
        }
      }
    } else if (parts.length > 0) {
      try {
        const html = markdownToTelegramHtml(parts[0]);
        await this.api.sendMessage(this.chatId, html, { parse_mode: "HTML" });
      } catch {
        try {
          await this.api.sendMessage(this.chatId, parts[0]);
        } catch {
          /* ignore */
        }
      }
    }

    // Remaining parts as new messages
    for (let i = 1; i < parts.length; i++) {
      try {
        const html = markdownToTelegramHtml(parts[i]);
        await this.api.sendMessage(this.chatId, html, { parse_mode: "HTML" });
      } catch {
        try {
          await this.api.sendMessage(this.chatId, parts[i]);
        } catch (err) {
          getLogger().error({ err }, "Failed to send message part");
        }
      }
    }
  }

  getLastMessageId(): number | null {
    return this.messageId;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.typingInterval) clearInterval(this.typingInterval);
    if (this.thinkingTimeout) clearTimeout(this.thinkingTimeout);
    if (this.pendingEdit) clearTimeout(this.pendingEdit);

    if (this.messageId) {
      this.api
        .editMessageText(
          this.chatId,
          this.messageId,
          `${this.accumulatedText}\n\n${this.t("streaming.cancelled")}`,
        )
        .catch(() => {});
    }
  }
}
