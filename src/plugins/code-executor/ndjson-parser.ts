import type { TaskProgress } from "../../core/interfaces";

/**
 * Parse a single NDJSON line from Claude Code CLI stream-json output.
 *
 * Line types:
 * - {"type": "system", "subtype": "init", ...}
 * - {"type": "assistant", "message": {"content": [...]}}
 * - {"type": "result", "subtype": "success"/"error_max_turns"/...}
 */
export function parseNdjsonLine(line: string): TaskProgress | null {
  if (!line.trim()) return null;

  try {
    const msg = JSON.parse(line);

    switch (msg.type) {
      case "system":
        return { type: "system", subtype: msg.subtype };

      case "assistant": {
        const textBlocks = (msg.message?.content ?? [])
          .filter((b: { type: string }) => b.type === "text")
          .map((b: { text: string }) => b.text)
          .join("");
        const toolUses = (msg.message?.content ?? [])
          .filter((b: { type: string }) => b.type === "tool_use")
          .map((b: { name: string }) => b.name);
        const toolInfo = toolUses.length > 0 ? ` [${toolUses.join(", ")}]` : "";
        return {
          type: "assistant",
          text: (textBlocks || "") + toolInfo || undefined,
        };
      }

      case "result":
        return {
          type: "result",
          subtype: msg.subtype,
          text: msg.result,
          isError: msg.is_error === true,
          durationMs: msg.duration_ms,
          numTurns: msg.num_turns,
          costUsd: msg.total_cost_usd,
        };

      default:
        return null;
    }
  } catch {
    return null;
  }
}
