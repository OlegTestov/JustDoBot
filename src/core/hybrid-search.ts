import type { HybridSearchResult, IMemoryProvider, Memory } from "./interfaces";

export interface HybridSearchWeights {
  semantic: number;
  keyword: number;
  recency: number;
}

const DEFAULT_WEIGHTS: HybridSearchWeights = {
  semantic: 0.4,
  keyword: 0.4,
  recency: 0.2,
};

// Weights when semantic search is not available
const FALLBACK_WEIGHTS: HybridSearchWeights = {
  semantic: 0,
  keyword: 0.67,
  recency: 0.33,
};

export async function hybridSearchMemories(
  db: IMemoryProvider,
  options: {
    query: string;
    embedding: number[] | null;
    limit: number;
    weights?: HybridSearchWeights;
  },
): Promise<HybridSearchResult[]> {
  const hasSemantic = options.embedding !== null;
  const w = options.weights ?? (hasSemantic ? DEFAULT_WEIGHTS : FALLBACK_WEIGHTS);

  // 1. Keyword search (FTS5) — always available
  const keywordResults: HybridSearchResult[] = db.searchMemoriesHybrid
    ? await db.searchMemoriesHybrid(options.query, null, options.limit * 2)
    : [];

  // 2. Semantic search (if embedding available)
  let semanticHits: Array<{ id: number; distance: number }> = [];
  if (hasSemantic && db.searchSemanticMemories) {
    semanticHits = await db.searchSemanticMemories(options.embedding!, options.limit * 2);
  }

  // 3. Fetch full memory objects for created_at (needed for recency scoring)
  const allMemories: Memory[] = db.getMemories
    ? await db.getMemories({ active: true, limit: 1000 })
    : [];
  const memoryMap = new Map(allMemories.map((m) => [m.id!, m]));

  // 4. Merge into score map
  const scoreMap = new Map<
    number,
    {
      id: number;
      content: string;
      keyword: number;
      semantic: number;
      recency: number;
      created_at?: string;
    }
  >();

  // Position-based keyword scoring: first result = 1.0, decreasing
  const keywordCount = keywordResults.length;
  for (let i = 0; i < keywordCount; i++) {
    const r = keywordResults[i];
    const mem = memoryMap.get(r.id);
    if (!scoreMap.has(r.id)) {
      scoreMap.set(r.id, {
        id: r.id,
        content: r.content,
        keyword: 0,
        semantic: 0,
        recency: 0,
        created_at: mem?.created_at,
      });
    }
    // First result gets 1.0, last gets close to 0
    scoreMap.get(r.id)!.keyword = keywordCount === 1 ? 1.0 : 1.0 - i / (keywordCount - 1);
  }

  // Normalize semantic scores: distance → similarity (1 - distance)
  for (const hit of semanticHits) {
    if (!scoreMap.has(hit.id)) {
      const mem = memoryMap.get(hit.id);
      if (!mem) continue;
      scoreMap.set(hit.id, {
        id: hit.id,
        content: mem.content,
        keyword: 0,
        semantic: 0,
        recency: 0,
        created_at: mem.created_at,
      });
    }
    // Convert distance to similarity: smaller distance = higher similarity
    scoreMap.get(hit.id)!.semantic = Math.max(0, 1.0 - hit.distance);
  }

  // 5. Compute recency scores
  const now = Date.now();
  for (const entry of scoreMap.values()) {
    if (entry.created_at) {
      const ageMs = now - new Date(entry.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // 1.0 today, ~0.5 at 30 days, ~0.25 at 90 days
      entry.recency = 1.0 / (1.0 + ageDays / 30.0);
    }
  }

  // 6. Compute final scores
  const results: HybridSearchResult[] = [];
  for (const entry of scoreMap.values()) {
    const score =
      w.semantic * entry.semantic + w.keyword * entry.keyword + w.recency * entry.recency;
    results.push({
      id: entry.id,
      content: entry.content,
      score,
      source: "memory",
    });
  }

  // 7. Sort and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, options.limit);
}
