import { basename, extname } from "node:path";
import { parse as parseYaml } from "yaml";

// ─── Types ──────────────────────────────────────────────────────

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  content: string;
  title: string | null;
  wikiLinks: string[];
}

// ─── Markdown Parser ────────────────────────────────────────────

export function parseMarkdown(raw: string, filePath: string): ParsedDocument {
  let frontmatter: Record<string, unknown> = {};
  let content = raw;

  // Extract YAML frontmatter between --- delimiters
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    try {
      const parsed = parseYaml(fmMatch[1]);
      if (parsed && typeof parsed === "object") {
        frontmatter = parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid YAML frontmatter — ignore
    }
    content = fmMatch[2];
  }

  // Resolve title: frontmatter.title > first # H1 > filename stem
  let title: string | null = null;
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    title = frontmatter.title.trim();
  } else {
    const h1Match = content.match(/^# (.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    } else {
      const ext = extname(filePath);
      title = basename(filePath, ext);
    }
  }

  // Extract wiki-links: [[Target]] and [[Target|Alias]]
  const wikiLinks: string[] = [];
  const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[1].trim();
    if (target && !wikiLinks.includes(target)) {
      wikiLinks.push(target);
    }
  }

  return { frontmatter, content, title, wikiLinks };
}

// ─── PDF Parser ─────────────────────────────────────────────────

export async function parsePDF(buffer: Buffer, filePath: string): Promise<ParsedDocument> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);

  const ext = extname(filePath);
  const title = basename(filePath, ext);

  return {
    frontmatter: {},
    content: result.text,
    title,
    wikiLinks: [],
  };
}

// ─── Wiki-link Resolution ───────────────────────────────────────

/**
 * Replace [[Note Name]] → "Note Name", [[Note|Alias]] → "Alias"
 * Used for creating searchable text from markdown content
 */
export function resolveWikiLinks(content: string): string {
  return content.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, target: string, alias?: string) => alias?.trim() ?? target.trim(),
  );
}
