const TELEGRAM_MAX_LENGTH = 4096;

export function splitMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Try to split at double newline
    let splitIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIdx > maxLength * 0.3) {
      parts.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx + 2);
      continue;
    }

    // Try single newline
    splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx > maxLength * 0.3) {
      parts.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx + 1);
      continue;
    }

    // Hard split
    parts.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }

  return parts;
}
