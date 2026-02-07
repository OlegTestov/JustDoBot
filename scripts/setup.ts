import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { GoogleOAuthClient } from "../src/plugins/collectors/google/oauth";
import {
  checkEnvironment,
  finalize,
  initState,
  loadExistingConfig,
  loadExistingEnv,
  mask,
  scanVaultDirs,
  validateTelegramToken,
  validateTokenFormat,
  type WizardState,
} from "./setup-core";

// ─── Constants ──────────────────────────────────────────────────

const LANGUAGES = [
  { code: "ar", label: "Arabic (العربية)" },
  { code: "zh", label: "Chinese (中文)" },
  { code: "en", label: "English" },
  { code: "fr", label: "French (Français)" },
  { code: "de", label: "German (Deutsch)" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "it", label: "Italian (Italiano)" },
  { code: "ja", label: "Japanese (日本語)" },
  { code: "ko", label: "Korean (한국어)" },
  { code: "pl", label: "Polish (Polski)" },
  { code: "pt", label: "Portuguese (Português)" },
  { code: "ru", label: "Russian (Русский)" },
  { code: "es", label: "Spanish (Español)" },
  { code: "tr", label: "Turkish (Türkçe)" },
  { code: "uk", label: "Ukrainian (Українська)" },
];

// ─── Readline Helpers ───────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Best-effort only, user can open URL manually.
  }
}

async function completeGoogleOAuthInCli(clientId: string, clientSecret: string): Promise<boolean> {
  const basePort = 19380;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    const redirectUri = `http://localhost:${port}/oauth/callback`;
    const oauth = new GoogleOAuthClient({
      clientId,
      clientSecret,
      redirectUri,
      tokenPath: "./data/google-tokens.json",
    });

    let settled = false;
    let resolveFlow: (v: boolean) => void = () => {};
    const flowPromise = new Promise<boolean>((resolve) => {
      resolveFlow = resolve;
    });

    let server: ReturnType<typeof Bun.serve> | null = null;
    try {
      server = Bun.serve({
        port,
        fetch: async (req) => {
          const url = new URL(req.url);
          if (url.pathname !== "/oauth/callback") {
            return new Response("Not Found", { status: 404 });
          }

          const code = url.searchParams.get("code");
          if (!code) {
            settled = true;
            resolveFlow(false);
            return new Response(
              "<h1>OAuth Error</h1><p>Missing authorization code. Return to terminal.</p>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          }

          try {
            await oauth.exchangeCodeForTokens(code);
            settled = true;
            resolveFlow(true);
            return new Response(
              "<h1>Google Connected</h1><p>You can close this tab and return to terminal.</p>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          } catch {
            settled = true;
            resolveFlow(false);
            return new Response(
              "<h1>OAuth Error</h1><p>Token exchange failed. Return to terminal.</p>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            );
          }
        },
      });
    } catch {
      // Port busy — try next one.
      continue;
    }

    const authUrl = oauth.generateAuthUrl();
    console.log(`\n  Opening Google OAuth in browser (port ${port})...`);
    console.log(`  If browser does not open, use this URL:\n  ${authUrl}\n`);
    openBrowser(authUrl);

    const result = await Promise.race([
      flowPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5 * 60 * 1000)),
    ]);

    if (!settled) {
      console.log("  OAuth timed out after 5 minutes.");
    }
    server.stop(true);
    return result;
  }

  console.log("  Could not start local OAuth callback server (ports 19380-19389 are busy).");
  return false;
}

async function askYesNo(question: string, defaultVal: boolean): Promise<boolean> {
  const hint = defaultVal ? "Y/n" : "y/N";
  const input = await ask(`${question} (${hint}): `);
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return defaultVal;
  return trimmed === "y" || trimmed === "yes";
}

// ─── Menu Display ────────────────────────────────────────────────

function initVisited(state: WizardState): Set<number> {
  const visited = new Set<number>();
  if (state.telegramToken && state.allowedUserId) visited.add(1);
  if (state.embeddingEnabled || state.openaiKey) visited.add(2);
  if (state.vaultEnabled || state.vaultPath) visited.add(3);
  if (state.voiceSttEnabled || state.geminiApiKey) visited.add(4);
  if (state.proactiveEnabled || state.googleEnabled) visited.add(5);
  if (state.codeAgentEnabled) visited.add(6);
  if (state.loggingFormat) visited.add(7);
  return visited;
}

function statusLabel(section: number, visited: Set<number>): string {
  if (visited.has(section)) return "configured";
  return section === 1 ? "required" : "optional";
}

async function showMenu(visited: Set<number>): Promise<number> {
  const s = (n: number) => statusLabel(n, visited);

  console.log(`
  ┌────────────────────────────────────────┐
  │         JustDoBot Setup Wizard         │
  └────────────────────────────────────────┘

  1. Telegram + AI + Language    [${s(1)}]
  2. Semantic Search              [${s(2)}]
  3. Obsidian Vault               [${s(3)}]
  4. Voice Messages               [${s(4)}]
  5. Proactive + Google           [${s(5)}]
  6. Code Agent                   [${s(6)}]
  7. Logging & Advanced           [${s(7)}]
  ────────────────────────────────────────
  8. Configure All
  9. Save & Finish
  0. Exit without saving
`);

  const input = await ask("  Choose (0-9): ");
  const num = parseInt(input.trim(), 10);
  if (Number.isNaN(num) || num < 0 || num > 9) return -1;
  return num;
}

// ─── Section 1: Telegram + AI Model + Language + Timezone ───────

async function configureTelegramAndModel(state: WizardState): Promise<void> {
  console.log("\n  --- Telegram + AI Model ---\n");

  // Token
  console.log("  Create a bot via @BotFather: https://t.me/BotFather");
  const tokenPrompt = state.telegramToken
    ? `  Bot token [${mask(state.telegramToken)}]: `
    : "  Bot token: ";
  const tokenInput = await ask(tokenPrompt);
  if (tokenInput.trim()) {
    const token = tokenInput.trim();
    if (!validateTokenFormat(token)) {
      console.log("  Warning: Token format looks invalid.");
      console.log("  Expected format: 123456789:ABCdefGHI...");
      const useAnyway = await askYesNo("  Use this token anyway?", false);
      if (!useAnyway) {
        return configureTelegramAndModel(state);
      }
    } else {
      // Try API validation
      console.log("  Checking token...");
      const result = await validateTelegramToken(token);
      if (result.valid) {
        console.log(`  Token valid: @${result.botUsername}`);
      } else {
        console.log(`  Warning: ${result.error}`);
        const useAnyway = await askYesNo("  Use this token anyway?", true);
        if (!useAnyway) {
          return configureTelegramAndModel(state);
        }
      }
    }
    state.telegramToken = token;
  }

  // User ID
  console.log("\n  To get your ID, send /start to @userinfobot");
  const userIdPrompt = state.allowedUserId ? `  User ID [${state.allowedUserId}]: ` : "  User ID: ";
  const userIdInput = await ask(userIdPrompt);
  if (userIdInput.trim()) {
    const id = userIdInput.trim();
    if (!/^\d+$/.test(id)) {
      console.log("  Warning: User ID should be a number (e.g., 123456789).");
      const useAnyway = await askYesNo("  Use this value anyway?", false);
      if (!useAnyway) {
        return configureTelegramAndModel(state);
      }
    }
    state.allowedUserId = id;
  }

  // Language
  console.log("\n  Bot language:");
  for (let i = 0; i < LANGUAGES.length; i++) {
    const num = String(i + 1).padStart(2, " ");
    console.log(`    ${num}. ${LANGUAGES[i].label}`);
  }
  const currentLangIdx = LANGUAGES.findIndex((l) => l.code === state.language);
  const currentLangNum = currentLangIdx >= 0 ? currentLangIdx + 1 : 3; // default English
  const langInput = await ask(`  Choose (1-${LANGUAGES.length}) [${currentLangNum}]: `);
  const langIdx = parseInt(langInput.trim(), 10) - 1;
  if (langIdx >= 0 && langIdx < LANGUAGES.length) {
    state.language = LANGUAGES[langIdx].code;
  }

  // Timezone
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentTz = state.timezone || detected || "UTC";
  console.log("\n  Timezone (IANA format, e.g. Europe/London, America/New_York)");
  const tzInput = await ask(`  Timezone [${currentTz}]: `);
  if (tzInput.trim()) {
    state.timezone = tzInput.trim();
  } else if (!state.timezone) {
    state.timezone = currentTz;
  }

  // Model
  console.log("\n  AI Model:");
  console.log("    1. claude-sonnet-4-5  — fast & smart (recommended)");
  console.log("    2. claude-opus-4-6    — most capable, slower");
  console.log("    3. claude-haiku-4-5   — fastest, cheapest");

  const modelMap: Record<string, string> = {
    "1": "claude-sonnet-4-5",
    "2": "claude-opus-4-6",
    "3": "claude-haiku-4-5",
  };
  const reverseMap: Record<string, string> = {
    "claude-sonnet-4-5": "1",
    "claude-opus-4-6": "2",
    "claude-haiku-4-5": "3",
  };
  const currentNum = reverseMap[state.model] || "1";
  const modelInput = await ask(`  Choose (1/2/3) [${currentNum}]: `);
  const chosen = modelMap[modelInput.trim()];
  if (chosen) state.model = chosen;

  console.log(`\n  Model: ${state.model}, Language: ${state.language}, TZ: ${state.timezone}`);
}

// ─── Section 2: Semantic Search ──────────────────────────────────

async function configureSemanticSearch(state: WizardState): Promise<void> {
  console.log("\n  --- Semantic Search ---\n");

  if (!state.sqliteVecAvailable) {
    console.log("  sqlite-vec not available — keyword matching only.");
    console.log("  Fix: brew install sqlite && bun run setup\n");
    state.embeddingEnabled = false;
    await ask("  Press Enter to continue...");
    return;
  }

  console.log("  Improves memory/vault retrieval using OpenAI embeddings.");
  console.log("  Requires an OpenAI API key (~$0.02 per 1M tokens).\n");

  state.embeddingEnabled = await askYesNo("  Enable semantic search?", state.embeddingEnabled);

  if (state.embeddingEnabled) {
    const keyPrompt = state.openaiKey
      ? `  OpenAI API key [${mask(state.openaiKey)}]: `
      : "  OpenAI API key: ";
    const keyInput = await ask(keyPrompt);
    if (keyInput.trim()) state.openaiKey = keyInput.trim();

    if (!state.openaiKey) {
      console.log("  No key provided — disabling semantic search.");
      state.embeddingEnabled = false;
    } else {
      console.log("  Embedding: enabled (text-embedding-3-small)");
    }
  } else {
    console.log("  Semantic search: disabled");
  }
}

// ─── Section 3: Obsidian Vault ───────────────────────────────────

async function configureVault(state: WizardState): Promise<void> {
  console.log("\n  --- Obsidian Vault ---\n");
  console.log("  Connect your Obsidian vault for knowledge retrieval.");
  console.log("  The bot will index .md files and search them.\n");

  state.vaultEnabled = await askYesNo("  Enable Obsidian vault?", state.vaultEnabled);

  if (!state.vaultEnabled) {
    console.log("  Vault: disabled");
    return;
  }

  // Path
  let pathValid = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const pathPrompt = state.vaultPath
      ? `  Vault path [${state.vaultPath}]: `
      : "  Vault path (absolute): ";
    const pathInput = await ask(pathPrompt);
    if (pathInput.trim()) state.vaultPath = pathInput.trim();

    if (!state.vaultPath) {
      console.log("  Path is required when vault is enabled.");
      continue;
    }
    if (existsSync(state.vaultPath)) {
      console.log("  Path exists.");
      pathValid = true;
      break;
    }
    console.log(`  Path not found: ${state.vaultPath}`);
    if (attempt < 2) console.log("  Try again:");
  }
  if (!pathValid && state.vaultPath) {
    console.log("  Warning: path does not exist yet. Make sure it's available before starting.");
  }

  // Scan vault folders
  const { content: folders, system: dotDirs } = pathValid
    ? scanVaultDirs(state.vaultPath)
    : { content: [], system: [] };

  if (folders.length > 0) {
    console.log(`\n  Found ${folders.length} folders:`);
    console.log(`  ${folders.join(", ")}`);
    if (dotDirs.length > 0) {
      console.log(`\n  Dot-dirs auto-excluded: ${dotDirs.join(", ")}`);
    }
    const excludeInput = await ask(
      `  Exclude additional folders (comma-separated, Enter = index all):\n  Example: Templates, Tags\n  > `,
    );
    const userExclude = excludeInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    state.vaultExclude = [...dotDirs, ...userExclude];
    state.vaultInclude = folders.filter((f: string) => !userExclude.includes(f));
  } else {
    console.log("\n  Could not scan vault folders (path may not exist yet).");
    console.log("  You can configure include/exclude manually in config.yaml.");
    state.vaultInclude = [];
    state.vaultExclude = [];
  }

  // Note about embedding
  if (!state.embeddingEnabled) {
    console.log("\n  Note: without semantic search, vault uses keyword matching only.");
  }

  console.log("\n  Vault: enabled");
}

// ─── Section 4: Voice Messages ───────────────────────────────────

async function configureVoice(state: WizardState): Promise<void> {
  console.log("\n  --- Voice Messages ---\n");
  console.log("  Enable speech-to-text and text-to-speech for voice messages.");
  console.log("  STT uses Gemini; TTS uses ElevenLabs or Gemini.\n");

  const enableVoice = await askYesNo("  Enable voice messages?", state.voiceSttEnabled);
  state.voiceSttEnabled = enableVoice;
  state.voiceTtsEnabled = enableVoice;

  if (!enableVoice) {
    console.log("  Voice: disabled");
    return;
  }

  // Gemini API key (for STT)
  console.log("\n  Gemini API key is required for speech-to-text.");
  console.log("  Get one at: https://aistudio.google.com/apikey");
  const geminiPrompt = state.geminiApiKey
    ? `  Gemini API key [${mask(state.geminiApiKey)}]: `
    : "  Gemini API key: ";
  const geminiInput = await ask(geminiPrompt);
  if (geminiInput.trim()) state.geminiApiKey = geminiInput.trim();

  if (!state.geminiApiKey) {
    console.log("  No Gemini key provided — voice STT will not work.");
  }

  // TTS provider
  console.log("\n  Text-to-Speech provider:");
  console.log("    1. ElevenLabs  — premium quality voices");
  console.log("    2. Gemini      — low cost, requires ffmpeg");
  const ttsMap: Record<string, "elevenlabs" | "gemini"> = {
    "1": "elevenlabs",
    "2": "gemini",
  };
  const currentTts = state.voiceTtsType === "gemini" ? "2" : "1";
  const ttsInput = await ask(`  Choose (1/2) [${currentTts}]: `);
  if (ttsMap[ttsInput.trim()]) state.voiceTtsType = ttsMap[ttsInput.trim()];

  // ElevenLabs-specific fields
  if (state.voiceTtsType === "elevenlabs") {
    const elKeyPrompt = state.elevenlabsApiKey
      ? `  ElevenLabs API key [${mask(state.elevenlabsApiKey)}]: `
      : "  ElevenLabs API key: ";
    const elKeyInput = await ask(elKeyPrompt);
    if (elKeyInput.trim()) state.elevenlabsApiKey = elKeyInput.trim();

    console.log("  Voice ID from your ElevenLabs dashboard.");
    const elVoicePrompt = state.elevenlabsVoiceId
      ? `  ElevenLabs Voice ID [${state.elevenlabsVoiceId}]: `
      : "  ElevenLabs Voice ID: ";
    const elVoiceInput = await ask(elVoicePrompt);
    if (elVoiceInput.trim()) state.elevenlabsVoiceId = elVoiceInput.trim();
  }

  // Auto-reply toggle
  state.voiceAutoReply = await askYesNo(
    "  Auto voice reply (send voice response to voice messages)?",
    state.voiceAutoReply,
  );

  console.log(`\n  Voice: enabled (STT: Gemini, TTS: ${state.voiceTtsType})`);
}

// ─── Section 5: Proactive + Google ───────────────────────────────

async function configureProactive(state: WizardState): Promise<void> {
  console.log("\n  --- Proactive Check-ins ---\n");
  console.log("  The bot periodically checks your calendar, email, and goals,");
  console.log("  then decides if you need a nudge.\n");

  state.proactiveEnabled = await askYesNo("  Enable proactive check-ins?", state.proactiveEnabled);

  if (state.proactiveEnabled) {
    // Check interval
    const intervalInput = await ask(
      `  Check interval in minutes (5-180) [${state.proactiveInterval}]: `,
    );
    if (intervalInput.trim()) {
      const val = parseInt(intervalInput.trim(), 10);
      if (val >= 5 && val <= 180) state.proactiveInterval = val;
      else console.log("  Invalid value, keeping current.");
    }

    // Cooldown
    const cooldownInput = await ask(
      `  Cooldown between messages in minutes (5-1440) [${state.proactiveCooldown}]: `,
    );
    if (cooldownInput.trim()) {
      const val = parseInt(cooldownInput.trim(), 10);
      if (val >= 5 && val <= 1440) state.proactiveCooldown = val;
      else console.log("  Invalid value, keeping current.");
    }

    // Quiet hours
    console.log("\n  Quiet hours — no proactive messages during this period.");
    const qStartInput = await ask(`  Quiet hours start (HH:MM) [${state.quietHoursStart}]: `);
    if (qStartInput.trim() && /^\d{2}:\d{2}$/.test(qStartInput.trim())) {
      state.quietHoursStart = qStartInput.trim();
    }

    const qEndInput = await ask(`  Quiet hours end (HH:MM) [${state.quietHoursEnd}]: `);
    if (qEndInput.trim() && /^\d{2}:\d{2}$/.test(qEndInput.trim())) {
      state.quietHoursEnd = qEndInput.trim();
    }

    console.log(
      `\n  Proactive: enabled (every ${state.proactiveInterval}min, ` +
        `cooldown ${state.proactiveCooldown}min, quiet ${state.quietHoursStart}-${state.quietHoursEnd})`,
    );
  } else {
    console.log("  Proactive check-ins: disabled");
  }

  // Google Integration
  console.log("\n  --- Google Integration ---\n");
  console.log("  Connect Gmail and Google Calendar as data sources.");
  console.log("  Requires OAuth credentials from Google Cloud Console.");
  console.log("  https://console.cloud.google.com/apis/credentials\n");

  state.googleEnabled = await askYesNo("  Enable Google integration?", state.googleEnabled);

  if (state.googleEnabled) {
    const clientIdPrompt = state.googleClientId
      ? `  Google Client ID [${mask(state.googleClientId)}]: `
      : "  Google Client ID: ";
    const clientIdInput = await ask(clientIdPrompt);
    if (clientIdInput.trim()) state.googleClientId = clientIdInput.trim();

    const clientSecretPrompt = state.googleClientSecret
      ? `  Google Client Secret [${mask(state.googleClientSecret)}]: `
      : "  Google Client Secret: ";
    const clientSecretInput = await ask(clientSecretPrompt);
    if (clientSecretInput.trim()) state.googleClientSecret = clientSecretInput.trim();

    if (!state.googleClientId || !state.googleClientSecret) {
      console.log("  Missing credentials — disabling Google integration.");
      state.googleEnabled = false;
    } else {
      console.log("  Google: credentials saved.");
      const authorizeNow = await askYesNo("  Authorize Google now in terminal flow?", true);
      if (authorizeNow) {
        const ok = await completeGoogleOAuthInCli(state.googleClientId, state.googleClientSecret);
        if (ok) {
          console.log("  Google OAuth completed.");
        } else {
          console.log("  Google OAuth was not completed.");
          const keepEnabled = await askYesNo(
            "  Keep Google integration enabled and complete OAuth later?",
            false,
          );
          if (!keepEnabled) {
            state.googleEnabled = false;
            console.log("  Google integration disabled.");
          }
        }
      } else {
        console.log("  Google OAuth skipped for now.");
      }
    }
  } else {
    console.log("  Google: disabled");
  }
}

// ─── Section 6: Code Agent ───────────────────────────────────────

async function configureCodeAgent(state: WizardState): Promise<void> {
  console.log("\n  --- Code Agent ---\n");
  console.log("  Let the bot write code in an isolated Docker sandbox.");
  console.log("  Requires Docker installed and Claude CLI credentials.\n");

  state.codeAgentEnabled = await askYesNo("  Enable Code Agent?", state.codeAgentEnabled);

  if (!state.codeAgentEnabled) {
    console.log("  Code Agent: disabled");
    return;
  }

  // Check Docker availability
  try {
    const proc = Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"], {
      timeout: 5000,
    });
    if (proc.exitCode === 0) {
      console.log(`  Docker detected: v${proc.stdout.toString().trim()}`);
    } else {
      console.log("  Warning: Docker does not appear to be running.");
      console.log("  Code Agent requires Docker — install it before use.");
    }
  } catch {
    console.log("  Warning: Docker not found on PATH.");
    console.log("  Code Agent requires Docker — install it before use.");
  }

  // Coding model
  console.log("\n  Coding model (independent of your chat model):");
  console.log("    1. Sonnet  — recommended balance");
  console.log("    2. Opus    — most capable");
  console.log("    3. Haiku   — fastest");
  const codeModelMap: Record<string, string> = {
    "1": "sonnet",
    "2": "opus",
    "3": "haiku",
  };
  const reverseCodeModel: Record<string, string> = {
    sonnet: "1",
    opus: "2",
    haiku: "3",
  };
  const currentCodeModel = reverseCodeModel[state.codeAgentModel] || "1";
  const codeModelInput = await ask(`  Choose (1/2/3) [${currentCodeModel}]: `);
  if (codeModelMap[codeModelInput.trim()]) {
    state.codeAgentModel = codeModelMap[codeModelInput.trim()];
  }

  // Max turns
  const turnsInput = await ask(`  Max turns per task (5-200) [${state.codeAgentMaxTurns}]: `);
  if (turnsInput.trim()) {
    const val = parseInt(turnsInput.trim(), 10);
    if (val >= 5 && val <= 200) state.codeAgentMaxTurns = val;
    else console.log("  Invalid value, keeping current.");
  }

  // Timeout
  const timeoutInput = await ask(
    `  Timeout per task in minutes (1-60) [${state.codeAgentTimeout}]: `,
  );
  if (timeoutInput.trim()) {
    const val = parseInt(timeoutInput.trim(), 10);
    if (val >= 1 && val <= 60) state.codeAgentTimeout = val;
    else console.log("  Invalid value, keeping current.");
  }

  console.log(
    `\n  Code Agent: enabled (model: ${state.codeAgentModel}, ` +
      `max turns: ${state.codeAgentMaxTurns}, timeout: ${state.codeAgentTimeout}min)`,
  );
}

// ─── Section 7: Logging & Advanced ──────────────────────────────

async function configureLogging(state: WizardState): Promise<void> {
  console.log("\n  --- Logging & Advanced ---\n");

  const formatInput = await ask(
    `  Log format — "pretty" (dev) or "json" (prod) [${state.loggingFormat}]: `,
  );
  if (formatInput.trim() === "pretty" || formatInput.trim() === "json") {
    state.loggingFormat = formatInput.trim();
  }

  console.log(`  Format: ${state.loggingFormat}`);
}

// ─── Finalize ────────────────────────────────────────────────────

function finalizeAndReport(state: WizardState): boolean {
  if (!state.telegramToken || !state.allowedUserId) {
    console.log("\n  Telegram token and user ID are required.");
    console.log("  Please configure section 1 first.\n");
    return false;
  }

  const ok = finalize(state);
  if (!ok) return false;

  console.log("\n  .env created");
  console.log("  config.yaml created");
  console.log("  data/ directory ready");
  console.log(`  SQLite initialized (Stage 3${state.sqliteVecAvailable ? " + vectors" : ""})`);

  if (state.googleEnabled && !existsSync("./data/google-tokens.json")) {
    console.log("\n  Google OAuth is not completed yet.");
    console.log("  Re-run setup and complete Google authorization in Section 5.");
  }

  if (!state.claudeCliAvailable) {
    console.log("\n  WARNING: Claude CLI was not detected.");
    console.log("  The bot WILL NOT work without it.");
    console.log("  Install: npm install -g @anthropic-ai/claude-code && claude login");
  }

  console.log("\n  Setup complete!\n");
  console.log("  Run the bot:");
  console.log("    bun run dev          — development (hot reload)");
  console.log("    bun run start        — production");
  console.log("    bun run docker       — Docker (recommended)\n");

  return true;
}

// ─── Configure All Helper ────────────────────────────────────────

async function configureAll(state: WizardState, visited: Set<number>): Promise<void> {
  await configureTelegramAndModel(state);
  visited.add(1);
  await configureSemanticSearch(state);
  visited.add(2);
  await configureVault(state);
  visited.add(3);
  await configureVoice(state);
  visited.add(4);
  await configureProactive(state);
  visited.add(5);
  await configureCodeAgent(state);
  visited.add(6);
  await configureLogging(state);
  visited.add(7);
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("\n  JustDoBot Setup Wizard\n");

  // Load existing config
  const existingEnv = loadExistingEnv();
  const existingConfig = loadExistingConfig();
  const isReconfigure = !!(existingEnv.TELEGRAM_BOT_TOKEN || existingConfig);

  if (isReconfigure) {
    console.log("  Existing configuration detected. Current values shown as defaults.\n");
  }

  // Environment checks
  console.log("  --- Environment ---\n");
  const envStatus = await checkEnvironment({ autoInstallSqlite: true });
  console.log(`  Bun ${envStatus.bunVersion}`);
  if (envStatus.claudeCliAvailable) {
    console.log(`  Claude CLI ${envStatus.claudeCliVersion}`);
  } else {
    console.log(
      "\n  Claude CLI not found. Install:\n" +
        "    npm install -g @anthropic-ai/claude-code\n" +
        "    claude login\n",
    );
    const proceed = await askYesNo("  Continue anyway?", true);
    if (!proceed) process.exit(1);
  }
  if (process.platform === "darwin" && envStatus.sqliteVecAvailable) {
    console.log("  Homebrew SQLite configured");
  }
  console.log(
    envStatus.sqliteVecAvailable
      ? "  sqlite-vec available"
      : "  sqlite-vec not available (keyword search only)",
  );

  // Initialize state
  const state = initState(existingEnv, existingConfig);
  state.sqliteVecAvailable = envStatus.sqliteVecAvailable;
  state.claudeCliAvailable = envStatus.claudeCliAvailable;
  const visited = initVisited(state);

  // Fresh install — offer Configure All
  if (!isReconfigure) {
    console.log("");
    const runAll = await askYesNo("  Run full setup?", true);
    if (runAll) {
      await configureAll(state, visited);
      finalizeAndReport(state);
      rl.close();
      return;
    }
  }

  // Menu loop
  let running = true;
  while (running) {
    const choice = await showMenu(visited);

    switch (choice) {
      case 1:
        await configureTelegramAndModel(state);
        visited.add(1);
        break;
      case 2:
        await configureSemanticSearch(state);
        visited.add(2);
        break;
      case 3:
        await configureVault(state);
        visited.add(3);
        break;
      case 4:
        await configureVoice(state);
        visited.add(4);
        break;
      case 5:
        await configureProactive(state);
        visited.add(5);
        break;
      case 6:
        await configureCodeAgent(state);
        visited.add(6);
        break;
      case 7:
        await configureLogging(state);
        visited.add(7);
        break;
      case 8:
        await configureAll(state, visited);
        break;
      case 9:
        if (finalizeAndReport(state)) {
          running = false;
        }
        break;
      case 0:
        if (visited.size > 0) {
          const confirmExit = await askYesNo("  Unsaved changes will be lost. Exit anyway?", false);
          if (!confirmExit) break;
        }
        console.log("  Exiting without saving.\n");
        running = false;
        break;
      default:
        console.log("  Invalid choice.\n");
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  rl.close();
  process.exit(1);
});
