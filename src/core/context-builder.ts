import { hybridSearchMemories } from "./hybrid-search";
import type {
  AssembledContext,
  CheckInLog,
  Goal,
  IEmbeddingProvider,
  IMemoryProvider,
  IVaultProvider,
  Memory,
  Message,
  VaultSearchResult,
} from "./interfaces";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export interface BudgetConfig {
  recent_messages: number;
  memories: number;
  goals: number;
  vault_docs: number;
  check_in: number;
  reserve: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  recent_messages: 0.4,
  memories: 0.15,
  goals: 0.07,
  vault_docs: 0.25,
  check_in: 0.05,
  reserve: 0.08,
};

export async function buildContext(
  sessionId: string,
  userMessage: string,
  db: IMemoryProvider,
  maxTokens: number,
  embeddingProvider: IEmbeddingProvider | null = null,
  budgetConfig: BudgetConfig = DEFAULT_BUDGET,
  vaultProvider: IVaultProvider | null = null,
  language = "en",
  checkInRepo: { getRecentLogs: (limit: number) => CheckInLog[] } | null = null,
  timezone = "UTC",
): Promise<AssembledContext> {
  let usedTokens = 0;

  // ─── Pass 1: Recent messages (40%) ──────────────────────────────
  const msgBudget = Math.floor(maxTokens * budgetConfig.recent_messages);
  const messages = await db.getRecentMessages(50, sessionId);

  const included: Message[] = [];
  let msgTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(`${msg.role}: ${msg.content}`);
    if (msgTokens + tokens > msgBudget) break;
    included.unshift(msg);
    msgTokens += tokens;
  }
  usedTokens += msgTokens;

  // ─── Pass 2: Relevant memories (15%) ────────────────────────────
  const relevantMemories: Memory[] = [];
  const memBudget = Math.floor(maxTokens * budgetConfig.memories);

  // Compute query embedding once — reused for memories and vault
  let queryEmbedding: number[] | null = null;
  if (embeddingProvider && userMessage) {
    try {
      queryEmbedding = await embeddingProvider.embed(userMessage);
    } catch {
      // Embedding failed, continue with FTS only
    }
  }

  if (userMessage && db.getMemories) {
    const searchResults = await hybridSearchMemories(db, {
      query: userMessage,
      embedding: queryEmbedding,
      limit: 20,
    });

    // Convert HybridSearchResult to Memory for context
    const allMemories = await db.getMemories({ active: true, limit: 100 });
    const memoryMap = new Map(allMemories.map((m) => [m.id!, m]));

    let memTokens = 0;
    for (const result of searchResults) {
      const mem = memoryMap.get(result.id);
      if (!mem) continue;
      const tokens = estimateTokens(mem.content);
      if (memTokens + tokens > memBudget) break;
      relevantMemories.push(mem);
      memTokens += tokens;
    }
    usedTokens += memTokens;
  }

  // ─── Pass 3: Active goals (7%) ─────────────────────────────────
  const activeGoals: Goal[] = [];
  const goalBudget = Math.floor(maxTokens * budgetConfig.goals);

  if (db.getActiveGoals) {
    const goals = await db.getActiveGoals();
    let goalTokens = 0;
    for (const goal of goals) {
      let text = `${goal.title}: ${goal.description ?? ""}`;
      if (goal.progress_notes) {
        try {
          const notes = JSON.parse(goal.progress_notes);
          if (Array.isArray(notes) && notes.length > 0) {
            text += ` ${notes[notes.length - 1].note ?? ""}`;
          }
        } catch {
          /* malformed JSON — ignore */
        }
      }
      const tokens = estimateTokens(text);
      if (goalTokens + tokens > goalBudget) break;
      activeGoals.push(goal);
      goalTokens += tokens;
    }
    usedTokens += goalTokens;
  }

  // ─── Pass 3.5: Vault documents (25%) ───────────────────────────
  const vaultResults: VaultSearchResult[] = [];
  const vaultBudget = Math.floor(maxTokens * budgetConfig.vault_docs);

  if (vaultProvider && userMessage) {
    try {
      const results = await vaultProvider.search(userMessage, queryEmbedding, 10);
      let vaultTokens = 0;
      for (const result of results) {
        const tokens = estimateTokens(result.content);
        if (vaultTokens + tokens > vaultBudget) break;
        vaultResults.push(result);
        vaultTokens += tokens;
      }
      usedTokens += vaultTokens;
    } catch {
      // Vault search failed — continue without vault results
    }
  }

  // ─── Pass 4: Check-in logs (5%) ────────────────────────────────
  const checkInLogs: CheckInLog[] = [];
  const checkInBudget = Math.floor(maxTokens * budgetConfig.check_in);

  if (checkInRepo) {
    const logs = checkInRepo.getRecentLogs(10);
    let checkInTokens = 0;
    for (const log of logs) {
      const text = `${log.created_at}: ${log.message_sent ?? "skipped"}`;
      const tokens = estimateTokens(text);
      if (checkInTokens + tokens > checkInBudget) break;
      checkInLogs.push(log);
      checkInTokens += tokens;
    }
    usedTokens += checkInTokens;
  }

  // ─── Pass 5: Redistribute unused budget to messages ─────────────
  // Only redistribute budgets that are actually unused
  let unusedBudget = checkInLogs.length === 0 ? Math.floor(maxTokens * budgetConfig.check_in) : 0;
  if (vaultResults.length === 0) {
    unusedBudget += Math.floor(maxTokens * budgetConfig.vault_docs);
  }

  if (unusedBudget > 0) {
    const extraBudget = msgBudget + unusedBudget;
    const extraIncluded: Message[] = [];
    let extraTokens = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const tokens = estimateTokens(`${msg.role}: ${msg.content}`);
      if (extraTokens + tokens > extraBudget) break;
      extraIncluded.unshift(msg);
      extraTokens += tokens;
    }
    if (extraIncluded.length > included.length) {
      const diff = extraTokens - msgTokens;
      usedTokens += diff;
      included.length = 0;
      included.push(...extraIncluded);
    }
  }

  return {
    recentMessages: included,
    relevantMemories,
    activeGoals,
    vaultResults,
    checkInLogs,
    tokenBudget: maxTokens,
    actualTokens: usedTokens,
    language,
    timezone,
  };
}
