const SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, "\\$1");
}

/**
 * Convert standard Markdown (Claude output) to Telegram HTML.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, [links](url)
 */
export function markdownToTelegramHtml(text: string): string {
  let result = text;

  // Escape HTML entities first
  result = result.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks: ```lang\n...\n``` → <pre><code>...</code></pre>
  result = result.replace(
    /```(?:\w*)\n([\s\S]*?)```/g,
    (_match, code: string) => `<pre><code>${code}</code></pre>`,
  );

  // Inline code: `...` → <code>...</code>
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => `<code>${code}</code>`);

  // Headings: # text → <b>text</b>
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_match, content: string) => `<b>${content}</b>`);

  // Bold: **text** → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, (_match, content: string) => `<b>${content}</b>`);

  // Italic: *text* → <i>text</i> (but not inside <b> tags — already handled by **bold**)
  result = result.replace(
    /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
    (_match, content: string) => `<i>${content}</i>`,
  );

  // Links: [text](url) → <a href="url">text</a>
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, text: string, url: string) => `<a href="${url}">${text}</a>`,
  );

  return result;
}
