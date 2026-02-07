// ─── Types ──────────────────────────────────────────────────────

export interface Chunk {
  index: number;
  content: string;
  headerPath: string; // e.g., "## Section"
}

export interface ChunkOptions {
  maxChunkSize?: number; // default: 1500
  overlapSize?: number; // default: 200
}

// ─── Chunker ────────────────────────────────────────────────────

/**
 * Split document content into chunks by ## headers.
 * Sections exceeding maxChunkSize are split by paragraphs with overlap.
 */
export function chunkDocument(content: string, options?: ChunkOptions): Chunk[] {
  const maxSize = options?.maxChunkSize ?? 1500;
  const overlap = options?.overlapSize ?? 200;

  if (!content.trim()) {
    return [];
  }

  // If short enough, return as single chunk
  if (content.length <= maxSize) {
    return [{ index: 0, content: content.trim(), headerPath: "" }];
  }

  // Split by ## headers (keep header with its section)
  const sections = splitByHeaders(content);

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    if (section.content.length <= maxSize) {
      chunks.push({
        index: chunkIndex++,
        content: section.content.trim(),
        headerPath: section.header,
      });
    } else {
      // Split large section by paragraphs with overlap
      const subChunks = splitByParagraphs(section.content, maxSize, overlap);
      for (const sub of subChunks) {
        chunks.push({
          index: chunkIndex++,
          content: sub.trim(),
          headerPath: section.header,
        });
      }
    }
  }

  // Filter out empty chunks
  return chunks.filter((c) => c.content.length > 0);
}

// ─── Internal ───────────────────────────────────────────────────

interface Section {
  header: string;
  content: string;
}

function splitByHeaders(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeader = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.match(/^#{2,3}\s+/)) {
      // Save previous section
      if (currentLines.length > 0) {
        sections.push({
          header: currentHeader,
          content: currentLines.join("\n"),
        });
      }
      currentHeader = line.trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Don't forget last section
  if (currentLines.length > 0) {
    sections.push({
      header: currentHeader,
      content: currentLines.join("\n"),
    });
  }

  return sections;
}

function splitByParagraphs(text: string, maxSize: number, overlap: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length > maxSize && current) {
      chunks.push(current);
      // Start next chunk with overlap from end of current
      const overlapText = current.length > overlap ? current.slice(-overlap) : current;
      current = `${overlapText}\n\n${paragraph}`;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}
