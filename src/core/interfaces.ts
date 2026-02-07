import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ─── Domain Types ───────────────────────────────────────────────

export interface Message {
  id?: number;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  telegram_message_id?: number;
  media_type?: string;
  media_url?: string;
  created_at?: string;
}

export interface Memory {
  id?: number;
  category: "fact" | "preference" | "person" | "insight";
  content: string;
  source_message_id?: number;
  active?: number; // 0 | 1
  confidence: number; // 0.0-1.0
  created_at?: string;
  updated_at?: string;
}

export interface Goal {
  id?: number;
  title: string;
  description?: string;
  status: "active" | "completed" | "paused" | "cancelled";
  deadline?: string; // YYYY-MM-DD
  progress_notes?: string; // JSON: [{date, note}]
  created_at?: string;
  updated_at?: string;
}

export interface VaultDocument {
  id?: number;
  file_path: string;
  chunk_index: number;
  title: string | null;
  content: string;
  content_hash: string;
  metadata?: string; // JSON: frontmatter, resolved wiki-links
  indexed_at?: string;
}

export interface VaultSearchResult {
  id: number;
  file_path: string;
  title: string | null;
  content: string;
  chunk_index: number;
  score: number;
}

export interface HybridSearchResult {
  id: number;
  content: string;
  score: number;
  source: "memory" | "goal";
}

export interface CheckInLog {
  id?: number;
  user_id?: string;
  data_hash: string;
  sources: string[];
  gating_result?: "text" | "call" | "skip";
  skip_reason?: string;
  urgency?: number;
  message_sent?: string;
  tokens_used?: number;
  created_at?: string;
}

export interface AssembledContext {
  recentMessages: Message[];
  relevantMemories: Memory[];
  activeGoals: Goal[];
  vaultResults: VaultSearchResult[];
  checkInLogs: CheckInLog[];
  tokenBudget: number;
  actualTokens: number;
  language: string;
  timezone: string;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  lastCheck: Date;
}

export type PluginConfig = Record<string, unknown>;

export interface SendOptions {
  parse_mode?: "MarkdownV2" | "HTML";
  reply_to_message_id?: number;
}

// ─── Message Handler ────────────────────────────────────────────

export type MessageHandler = (ctx: {
  chatId: number;
  userId: number;
  text: string;
  messageId: number;
  chatType: string;
  photo?: { url: string; fileId: string };
  document?: { url: string; fileId: string };
  voice?: { buffer: Buffer; duration: number; mimeType: string };
  caption?: string;
  raw: unknown;
}) => Promise<void>;

// ─── Plugin Interfaces ──────────────────────────────────────────

export interface IPlugin {
  name: string;
  version: string;
  init(config: PluginConfig): Promise<void>;
  destroy(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}

export interface IAIEngine extends IPlugin {
  queryStream(
    prompt: string,
    context: AssembledContext,
    options?: {
      abortController?: AbortController;
      systemPrompt?: string;
      mcpServers?: Record<string, unknown>;
    },
  ): AsyncGenerator<SDKMessage, void>;
  queryStructured?<T>(prompt: string, jsonSchema: Record<string, unknown>): Promise<T>;
  abort(): void;
}

export interface IMemoryProvider extends IPlugin {
  saveMessage(msg: Message): Promise<void>;
  getRecentMessages(limit: number, sessionId?: string): Promise<Message[]>;
  getLastMessageTime(sessionId: string): Promise<string | null>;
  flush(): Promise<void>;

  // Stage 2 — memories
  saveMemory?(memory: Memory): Promise<number>;
  getMemories?(options: { active?: boolean; limit?: number }): Promise<Memory[]>;
  searchMemoriesHybrid?(
    query: string,
    embedding: number[] | null,
    limit: number,
  ): Promise<HybridSearchResult[]>;
  checkMemoryDuplicate?(embedding: number[], threshold: number): Promise<Memory | null>;
  checkExactDuplicate?(content: string): Promise<Memory | null>;
  updateMemory?(id: number, updates: Partial<Memory>): Promise<void>;
  deleteMemory?(id: number): Promise<void>;

  // Stage 2 — goals
  saveGoal?(goal: Omit<Goal, "id" | "created_at" | "updated_at">): Promise<number>;
  getActiveGoals?(): Promise<Goal[]>;
  getGoal?(id: number): Promise<Goal | null>;
  updateGoal?(id: number, action: string, note?: string): Promise<void>;
  editGoal?(
    id: number,
    updates: { title?: string; description?: string; deadline?: string | null },
    note?: string,
  ): Promise<Goal | null>;
  searchGoalsByTitle?(title: string): Promise<Goal[]>;

  // Stage 2 — vectors
  saveVecMemory?(memoryId: number, embedding: number[]): Promise<void>;
  saveVecGoal?(goalId: number, embedding: number[]): Promise<void>;
  searchSemanticMemories?(
    embedding: number[],
    limit: number,
  ): Promise<Array<{ id: number; distance: number }>>;
  searchSemanticGoals?(
    embedding: number[],
    limit: number,
  ): Promise<Array<{ id: number; distance: number }>>;

  // Stage 4 — vault changes for collectors
  getRecentVaultDocuments?(
    since: string,
    limit: number,
  ): Promise<Array<{ title: string; file_path: string; indexed_at: string }>>;
}

export interface IMessenger extends IPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<number>;
  editMessage(
    chatId: number,
    messageId: number,
    text: string,
    options?: SendOptions,
  ): Promise<void>;
  sendChatAction(chatId: number, action: string): Promise<void>;
  onMessage(handler: MessageHandler): void;
}

// Stage 2+
export interface IEmbeddingProvider extends IPlugin {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

// Stage 3+
export interface IVaultProvider extends IPlugin {
  index(): Promise<number>;
  search(query: string, embedding: number[] | null, limit: number): Promise<VaultSearchResult[]>;
  getDocumentCount(): Promise<number>;
  startWatching(): void;
  stopWatching(): void;
  writeNote?(path: string, content: string): Promise<void>;
}

// Stage 4+
export interface ICollector extends IPlugin {
  collect(): Promise<unknown>;
  type: "email" | "calendar" | "goals" | "vault" | "custom";
}

// Stage 5+
export interface ISTTProvider extends IPlugin {
  transcribe(audio: Buffer, format: string): Promise<string>;
}

export interface ITTSProvider extends IPlugin {
  synthesize(text: string): Promise<Buffer>;
}

// Stage 6 — Code Agent

export interface CodeProject {
  id?: number;
  name: string;
  status: "active" | "running" | "completed" | "error" | "deleted";
  userId: string;
  lastTaskPrompt?: string;
  lastTaskResult?: string;
  lastTaskDurationMs?: number;
  lastTaskTurns?: number;
  lastTaskCostUsd?: number;
  totalCostUsd?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskProgress {
  type: "system" | "assistant" | "result";
  subtype?: string;
  text?: string;
  isError?: boolean;
  durationMs?: number;
  numTurns?: number;
  costUsd?: number;
}

export interface TaskResult {
  success: boolean;
  resultText: string;
  durationMs: number;
  numTurns: number;
  costUsd: number;
  exitCode: number;
}

export interface TaskCallbacks {
  onProgress: (text: string) => Promise<void>;
  onComplete: (result: TaskResult, projectName: string) => Promise<void>;
  onError: (error: string, projectName: string) => Promise<void>;
}

export interface ICodeExecutor extends IPlugin {
  runTaskInBackground(
    projectName: string,
    prompt: string,
    userId: string,
    callbacks: TaskCallbacks,
  ): void;

  cancelTask(projectName: string): Promise<void>;
  isTaskRunning(projectName: string): boolean;
  getRunningTaskCount(): number;

  createProject(name: string, userId: string): Promise<CodeProject>;
  deleteProject(name: string): Promise<void>;
  getProject(name: string): Promise<CodeProject | null>;
  listProjects(userId?: string): Promise<CodeProject[]>;

  destroySandbox(): Promise<void>;

  pushCredentials?(credentialsJson: string): Promise<void>;
}
