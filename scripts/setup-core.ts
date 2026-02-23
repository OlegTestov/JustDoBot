import { Database } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as sqliteVec from "sqlite-vec";
import { parse as parseYaml } from "yaml";
import { STAGE1_DDL } from "../src/plugins/database/sqlite/schema";
import { STAGE2_DDL_CORE, stage2VecDDL } from "../src/plugins/database/sqlite/schema-stage2";
import { STAGE3_DDL_CORE, stage3VecDDL } from "../src/plugins/database/sqlite/schema-stage3";
import { STAGE4_DDL_CORE } from "../src/plugins/database/sqlite/schema-stage4";
import { STAGE6_DDL_CORE } from "../src/plugins/database/sqlite/schema-stage6";

// ─── Types ──────────────────────────────────────────────────────

export interface WizardState {
  sqliteVecAvailable: boolean;
  claudeCliAvailable: boolean;
  // Section 1: Telegram + AI + Language
  telegramToken: string;
  allowedUserId: string;
  model: string;
  language: string;
  timezone: string;
  // Section 2: Obsidian Vault
  vaultEnabled: boolean;
  vaultPath: string;
  vaultInclude: string[];
  vaultExclude: string[];
  vaultWatchMode: "poll" | "native";
  vaultPollInterval: number;
  // Section 4: Proactive
  proactiveEnabled: boolean;
  proactiveInterval: number;
  proactiveCooldown: number;
  reminderCooldown: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  // Section 5: Voice
  voiceSttEnabled: boolean;
  geminiApiKey: string;
  voiceTtsEnabled: boolean;
  voiceTtsType: "elevenlabs" | "gemini";
  elevenlabsApiKey: string;
  elevenlabsVoiceId: string;
  voiceAutoReply: boolean;
  // Section 6: Code Agent
  codeAgentEnabled: boolean;
  codeAgentModel: string;
  codeAgentMaxTurns: number;
  codeAgentTimeout: number;
  // Section 7: Logging
  loggingFormat: string;
  // Docker auth (auto-detected, not user-entered)
  claudeCredentials: ClaudeCredentials | null;
}

// ─── Telegram Token Validation ──────────────────────────────────

const TELEGRAM_TOKEN_REGEX = /^\d{8,10}:[A-Za-z0-9_-]{35}$/;

export function validateTokenFormat(token: string): boolean {
  return TELEGRAM_TOKEN_REGEX.test(token);
}

export async function validateTelegramToken(
  token: string,
): Promise<{ valid: boolean; botUsername?: string; error?: string }> {
  if (!validateTokenFormat(token)) {
    return { valid: false, error: "Invalid format. Expected: 123456789:ABCdefGHI..." };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await resp.json()) as {
      ok: boolean;
      result?: { username: string };
      description?: string;
    };
    if (data.ok && data.result) {
      return { valid: true, botUsername: data.result.username };
    }
    return { valid: false, error: data.description ?? "Token rejected by Telegram" };
  } catch {
    return { valid: false, error: "Could not reach Telegram API (no internet?)" };
  }
}

// ─── Vault Scanner ──────────────────────────────────────────────

export function scanVaultDirs(vaultPath: string): { content: string[]; system: string[] } {
  try {
    const content: string[] = [];
    const system: string[] = [];
    for (const name of readdirSync(vaultPath)) {
      try {
        if (!statSync(`${vaultPath}/${name}`).isDirectory()) continue;
      } catch {
        continue;
      }
      if (name.startsWith(".")) system.push(name);
      else content.push(name);
    }
    return { content: content.sort(), system: system.sort() };
  } catch {
    return { content: [], system: [] };
  }
}

// ─── Config Loaders ─────────────────────────────────────────────

export function loadExistingEnv(): Record<string, string> {
  if (!existsSync(".env")) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

export function loadExistingConfig(): Record<string, unknown> | null {
  if (!existsSync("config.yaml")) return null;
  try {
    return parseYaml(readFileSync("config.yaml", "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function mask(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

// ─── State Initialization ───────────────────────────────────────

export function initState(
  env: Record<string, string>,
  config: Record<string, unknown> | null,
): WizardState {
  const bot = config?.bot as Record<string, unknown> | undefined;
  const messenger = config?.messenger as Record<string, unknown> | undefined;
  const ai = config?.ai_engine as Record<string, unknown> | undefined;
  const logging = config?.logging as Record<string, unknown> | undefined;
  const vault = config?.vault as Record<string, unknown> | undefined;
  const proactive = config?.proactive as Record<string, unknown> | undefined;
  const collectors = config?.collectors as Record<string, unknown> | undefined;
  const google = collectors?.google as Record<string, unknown> | undefined;
  const quietHours = proactive?.quiet_hours as Record<string, unknown> | undefined;
  const voice = config?.voice as Record<string, unknown> | undefined;
  const codeExec = config?.code_execution as Record<string, unknown> | undefined;

  // Read token/userId from .env first, fall back to config.yaml values
  const cfgToken = (messenger?.token as string) || "";
  const cfgAllowedUsers = (messenger?.allowed_users as string[]) || [];

  return {
    sqliteVecAvailable: false,
    claudeCliAvailable: false,
    // Section 1
    telegramToken: env.TELEGRAM_BOT_TOKEN || cfgToken,
    allowedUserId: env.ALLOWED_USER_ID || cfgAllowedUsers[0] || "",
    model: (ai?.model as string) || "claude-sonnet-4-6",
    language: (bot?.language as string) || "en",
    timezone: (bot?.timezone as string) || "UTC",
    // Section 2
    vaultEnabled: (vault?.enabled as boolean) ?? false,
    vaultPath: env.VAULT_PATH || (vault?.path as string) || "",
    vaultInclude: (vault?.include as string[]) || [],
    vaultExclude: (vault?.exclude as string[]) || [],
    vaultWatchMode: ((vault?.watch_mode as string) || "poll") as "poll" | "native",
    vaultPollInterval: (vault?.poll_interval_seconds as number) || 60,
    // Section 4: Proactive
    proactiveEnabled: (proactive?.enabled as boolean) ?? false,
    proactiveInterval: (proactive?.check_interval_minutes as number) || 5,
    proactiveCooldown: (proactive?.cooldown_minutes as number) || 15,
    reminderCooldown: (proactive?.reminder_cooldown_minutes as number) || 180,
    quietHoursStart: (quietHours?.start as string) || "22:00",
    quietHoursEnd: (quietHours?.end as string) || "08:00",
    googleEnabled: (google?.enabled as boolean) ?? false,
    googleClientId: env.GOOGLE_CLIENT_ID || (google?.client_id as string) || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || (google?.client_secret as string) || "",
    // Section 5: Voice
    voiceSttEnabled: ((voice?.stt as Record<string, unknown>)?.enabled as boolean) ?? false,
    geminiApiKey: env.GEMINI_API_KEY || "",
    voiceTtsEnabled: ((voice?.tts as Record<string, unknown>)?.enabled as boolean) ?? false,
    voiceTtsType: (((voice?.tts as Record<string, unknown>)?.type as string) || "gemini") as
      | "elevenlabs"
      | "gemini",
    elevenlabsApiKey: env.ELEVENLABS_API_KEY || "",
    elevenlabsVoiceId:
      env.ELEVENLABS_VOICE_ID ||
      ((voice?.tts as Record<string, unknown>)?.voice_id as string) ||
      "",
    voiceAutoReply: ((voice?.tts as Record<string, unknown>)?.auto_reply as boolean) ?? true,
    // Section 6: Code Agent
    codeAgentEnabled: (codeExec?.enabled as boolean) ?? false,
    codeAgentModel: (codeExec?.model as string) || "sonnet",
    codeAgentMaxTurns: (codeExec?.max_turns as number) || 50,
    codeAgentTimeout: (codeExec?.timeout_minutes as number) || 10,
    // Section 7
    loggingFormat: (logging?.format as string) || "pretty",
    // Docker auth
    claudeCredentials: null,
  };
}

// ─── Environment Checks ─────────────────────────────────────────

export interface EnvironmentStatus {
  sqliteVecAvailable: boolean;
  claudeCliAvailable: boolean;
  claudeCliVersion: string;
  bunVersion: string;
  claudeCredentials: ClaudeCredentials | null;
}

export async function checkEnvironment(
  options: { autoInstallSqlite?: boolean } = {},
): Promise<EnvironmentStatus> {
  const status: EnvironmentStatus = {
    sqliteVecAvailable: false,
    claudeCliAvailable: false,
    claudeCliVersion: "",
    bunVersion: Bun.version,
    claudeCredentials: null,
  };

  // Claude CLI
  try {
    const proc = Bun.spawnSync(["claude", "--version"]);
    if (proc.exitCode === 0) {
      status.claudeCliAvailable = true;
      status.claudeCliVersion = proc.stdout.toString().trim();
    }
  } catch {
    // not found
  }

  // sqlite-vec (macOS Homebrew SQLite)
  if (process.platform === "darwin") {
    const brewPaths = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
    ];
    let brewFound = false;
    for (const p of brewPaths) {
      if (existsSync(p)) {
        try {
          Database.setCustomSQLite(p);
          brewFound = true;
          break;
        } catch {
          /* incompatible version */
        }
      }
    }

    if (!brewFound && options.autoInstallSqlite) {
      // Try auto-installing via Homebrew
      try {
        const proc = Bun.spawnSync(["brew", "install", "sqlite"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        if (proc.exitCode === 0) {
          for (const p of brewPaths) {
            if (existsSync(p)) {
              try {
                Database.setCustomSQLite(p);
                brewFound = true;
              } catch {
                /* ignore */
              }
              break;
            }
          }
        }
      } catch {
        // brew not available
      }
    }
  }

  // Verify sqlite-vec
  try {
    const testDb = new Database(":memory:");
    sqliteVec.load(testDb);
    testDb.close();
    status.sqliteVecAvailable = true;
  } catch {
    // not available
  }

  // Claude OAuth credentials (for Docker deployment)
  const creds = await detectClaudeCredentials();
  if (creds) {
    status.claudeCredentials = creds;
  }

  return status;
}

// ─── Claude OAuth Credentials Detection ─────────────────────────

export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
}

/**
 * Auto-detect Claude OAuth credentials for Docker deployment.
 * Extracts FULL credentials (access + refresh + expiry) so the SDK
 * can auto-refresh expired tokens without user intervention.
 *
 * - macOS: extract from Keychain (where Claude CLI stores it after `claude login`)
 * - Linux: read from plaintext ~/.claude/.credentials.json
 * - Fallback: check secrets/claude-credentials.json (previously saved)
 * - Returns null if not found (bot still works locally, just not in Docker)
 */
export async function detectClaudeCredentials(): Promise<ClaudeCredentials | null> {
  // 1. macOS: extract from Keychain (always freshest — Claude CLI auto-refreshes here)
  if (process.platform === "darwin") {
    try {
      const proc = Bun.spawnSync([
        "security",
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-w",
      ]);
      if (proc.exitCode === 0) {
        const json = JSON.parse(proc.stdout.toString().trim());
        const oauth = json?.claudeAiOauth;
        if (oauth?.accessToken && typeof oauth.accessToken === "string") {
          return {
            accessToken: oauth.accessToken,
            refreshToken: oauth.refreshToken ?? null,
            expiresAt: oauth.expiresAt ?? null,
            scopes: oauth.scopes ?? ["user:inference"],
          };
        }
      }
    } catch {
      // Keychain not accessible or entry not found
    }
  }

  // 2. Linux / fallback: read from plaintext credentials file
  const home = process.env.HOME || "";
  const credPaths = [`${home}/.claude/.credentials.json`, `${home}/.claude/credentials.json`];
  for (const credPath of credPaths) {
    try {
      if (existsSync(credPath)) {
        const json = JSON.parse(readFileSync(credPath, "utf-8"));
        const oauth = json?.claudeAiOauth;
        if (oauth?.accessToken) {
          return {
            accessToken: oauth.accessToken,
            refreshToken: oauth.refreshToken ?? null,
            expiresAt: oauth.expiresAt ?? null,
            scopes: oauth.scopes ?? ["user:inference"],
          };
        }
      }
    } catch {
      // malformed or unreadable
    }
  }

  // 3. Last resort: previously saved credentials file
  if (existsSync("secrets/claude-credentials.json")) {
    try {
      const saved = JSON.parse(readFileSync("secrets/claude-credentials.json", "utf-8"));
      const creds = saved?.claudeAiOauth;
      if (creds?.accessToken && creds?.refreshToken) {
        return {
          accessToken: creds.accessToken,
          refreshToken: creds.refreshToken,
          expiresAt: creds.expiresAt ?? null,
          scopes: creds.scopes ?? ["user:inference"],
        };
      }
    } catch {
      // malformed
    }
  }

  return null;
}

/**
 * Save full Claude credentials to secrets/claude-credentials.json.
 * Also generates secrets/.docker-env with base64-encoded credentials
 * for Docker entrypoint injection (credentials are NOT mounted as a volume).
 */
export function saveClaudeCredentials(creds: ClaudeCredentials): void {
  if (!existsSync("secrets")) {
    mkdirSync("secrets", { recursive: true });
  }
  const payload = {
    claudeAiOauth: {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes,
    },
  };
  const jsonStr = JSON.stringify(payload, null, 2);
  writeFileSync("secrets/claude-credentials.json", jsonStr, { mode: 0o600 });
  try {
    chmodSync("secrets/claude-credentials.json", 0o600);
  } catch {
    // restricted FS
  }

  // Generate .docker-env for Docker entrypoint credential injection
  const b64 = Buffer.from(jsonStr).toString("base64");
  writeFileSync("secrets/.docker-env", `CLAUDE_CREDENTIALS_B64=${b64}\n`, { mode: 0o600 });
  try {
    chmodSync("secrets/.docker-env", 0o600);
  } catch {
    // restricted FS
  }
}

// ─── File Generation ────────────────────────────────────────────

export function generateEnvFile(state: WizardState): void {
  let envContent = `TELEGRAM_BOT_TOKEN=${state.telegramToken}\nALLOWED_USER_ID=${state.allowedUserId}\n`;
  if (state.vaultEnabled && state.vaultPath) {
    envContent += `VAULT_PATH=${state.vaultPath}\n`;
  }
  if (state.googleEnabled && state.googleClientId) {
    envContent += `GOOGLE_CLIENT_ID=${state.googleClientId}\n`;
    envContent += `GOOGLE_CLIENT_SECRET=${state.googleClientSecret}\n`;
  }
  if (state.geminiApiKey) {
    envContent += `GEMINI_API_KEY=${state.geminiApiKey}\n`;
  }
  if (state.elevenlabsApiKey) {
    envContent += `ELEVENLABS_API_KEY=${state.elevenlabsApiKey}\n`;
  }
  if (state.elevenlabsVoiceId) {
    envContent += `ELEVENLABS_VOICE_ID=${state.elevenlabsVoiceId}\n`;
  }
  // Claude credentials saved separately to secrets/claude-credentials.json
  // (not in .env — the SDK needs full credentials with refresh_token for auto-refresh)
  if (state.claudeCredentials) {
    saveClaudeCredentials(state.claudeCredentials);
  }
  writeFileSync(".env", envContent, { mode: 0o600 });
  try {
    chmodSync(".env", 0o600);
  } catch {
    // Windows or restricted FS — ignore
  }
}

export function generateConfigYaml(state: WizardState): string {
  const includeYaml = JSON.stringify(state.vaultInclude);
  const excludeYaml = JSON.stringify(state.vaultExclude);

  const configContent = `bot:
  name: "JustDoBot"
  language: "${state.language}"
  timezone: "${state.timezone}"

messenger:
  type: "telegram"
  token: "${state.telegramToken}"
  allowed_users: ["${state.allowedUserId}"]
  allowed_chats: []
  group_mode: "mention_only"
  mode: "polling"

ai_engine:
  type: "claude-agent-sdk"
  model: "${state.model}"
  max_turns: 10
  allowed_tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"]
  timeout_seconds: 180
  streaming: true

database:
  type: "sqlite"
  path: "./data/bot.db"

context:
  max_tokens: 12000
  session_timeout_hours: 6

streaming:
  enabled: true
  edit_debounce_ms: 1000
  thinking_timeout_ms: 2000

logging:
  level: "info"
  format: "${state.loggingFormat}"

vault:
  enabled: ${state.vaultEnabled}
  type: "obsidian"
  path: "${state.vaultEnabled ? state.vaultPath : ""}"
  include: ${includeYaml}
  exclude: ${excludeYaml}
  watch_mode: "${state.vaultWatchMode}"
  poll_interval_seconds: ${state.vaultPollInterval}

proactive:
  enabled: ${state.proactiveEnabled}
  check_interval_minutes: ${state.proactiveInterval}
  cooldown_minutes: ${state.proactiveCooldown}
  reminder_cooldown_minutes: ${state.reminderCooldown}
  quiet_hours:
    start: "${state.quietHoursStart}"
    end: "${state.quietHoursEnd}"
${state.googleEnabled ? `\ncollectors:\n  google:\n    enabled: true\n    client_id: "${state.googleClientId}"\n    client_secret: "${state.googleClientSecret}"\n    gmail:\n      enabled: true\n    calendar:\n      enabled: true\n` : ""}${state.voiceSttEnabled || state.voiceTtsEnabled ? `\nvoice:\n  stt:\n    enabled: ${state.voiceSttEnabled}\n    type: "gemini"\n    model: "gemini-2.5-flash"\n  tts:\n    enabled: ${state.voiceTtsEnabled}\n    type: "${state.voiceTtsType}"\n    auto_reply: ${state.voiceAutoReply}${state.voiceTtsType === "elevenlabs" && state.elevenlabsVoiceId ? `\n    voice_id: "${state.elevenlabsVoiceId}"` : ""}\n` : ""}${state.codeAgentEnabled ? `\ncode_execution:\n  enabled: true\n  model: "${state.codeAgentModel}"\n  max_turns: ${state.codeAgentMaxTurns}\n  timeout_minutes: ${state.codeAgentTimeout}\n` : ""}
`;

  writeFileSync("config.yaml", configContent);
  return configContent;
}

export function initializeDatabase(state: WizardState): void {
  if (!existsSync("data")) {
    mkdirSync("data", { recursive: true });
  }

  const db = new Database("./data/bot.db");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(STAGE1_DDL);
  db.exec(STAGE2_DDL_CORE);
  db.exec(STAGE3_DDL_CORE);
  db.exec(STAGE4_DDL_CORE);
  db.exec(STAGE6_DDL_CORE);
  if (state.sqliteVecAvailable) {
    sqliteVec.load(db);
    db.exec(stage2VecDDL(768));
    db.exec(stage3VecDDL(768));
  }
  db.close();
}

export function finalize(state: WizardState): boolean {
  if (!state.telegramToken || !state.allowedUserId) {
    return false;
  }

  generateEnvFile(state);
  generateConfigYaml(state);
  initializeDatabase(state);
  return true;
}
