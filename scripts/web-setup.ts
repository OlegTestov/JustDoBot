import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GoogleOAuthClient } from "../src/plugins/collectors/google/oauth";
import { runDiagnostics } from "./doctor";
import {
  checkEnvironment,
  finalize,
  initState,
  loadExistingConfig,
  loadExistingEnv,
  mask,
  validateTelegramToken,
  validateTokenFormat,
  type WizardState,
} from "./setup-core";

// ─── Constants ──────────────────────────────────────────────────

const BASE_PORT = 19380;
const MAX_PORT_ATTEMPTS = 10;
const SCRIPT_DIR = import.meta.dir;
const HTML_PATH = join(SCRIPT_DIR, "web-setup.html");

// Module-level state for Google OAuth flow
let pendingOAuth: GoogleOAuthClient | null = null;
let serverPort: number = BASE_PORT;

// ─── Static Assets ──────────────────────────────────────────────

const I18N_DIR = join(SCRIPT_DIR, "i18n");
const CSS_PATH = join(SCRIPT_DIR, "web-setup.css");
const JS_PATH = join(SCRIPT_DIR, "web-setup.js");

let cachedHtml: string | null = null;
function getHtml(): string {
  if (!cachedHtml) cachedHtml = readFileSync(HTML_PATH, "utf-8");
  return cachedHtml;
}

let cachedCss: string | null = null;
function getCss(): string {
  if (!cachedCss) cachedCss = readFileSync(CSS_PATH, "utf-8");
  return cachedCss;
}

let cachedJs: string | null = null;
function getJs(): string {
  if (!cachedJs) {
    const js = readFileSync(JS_PATH, "utf-8");
    const en = readFileSync(join(I18N_DIR, "en.json"), "utf-8");
    cachedJs = js.replace("/* __I18N_EN__ */", `var _i18nEnStrings = ${en};`);
  }
  return cachedJs;
}

// ─── Helpers ────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ─── API Handlers ───────────────────────────────────────────────

async function handleStatus(): Promise<Response> {
  const env = loadExistingEnv();
  const config = loadExistingConfig();
  const state = initState(env, config);
  const envStatus = await checkEnvironment();

  return jsonResponse({
    existingState: {
      token: state.telegramToken ? mask(state.telegramToken) : "",
      tokenSet: state.telegramToken.length > 0,
      userId: state.allowedUserId,
      language: state.language,
      timezone: state.timezone,
      model: state.model,
      embeddingsEnabled: state.embeddingEnabled,
      openaiKey: state.openaiKey ? mask(state.openaiKey) : "",
      openaiKeySet: state.openaiKey.length > 0,
      vaultEnabled: state.vaultEnabled,
      vaultPath: state.vaultPath,
      proactiveEnabled: state.proactiveEnabled,
      proactiveInterval: state.proactiveInterval,
      proactiveCooldown: state.proactiveCooldown,
      quietHoursStart: state.quietHoursStart,
      quietHoursEnd: state.quietHoursEnd,
      googleEnabled: state.googleEnabled,
      voiceSttEnabled: state.voiceSttEnabled,
      geminiKey: state.geminiApiKey ? mask(state.geminiApiKey) : "",
      geminiKeySet: state.geminiApiKey.length > 0,
      voiceTtsEnabled: state.voiceTtsEnabled,
      voiceTtsType: state.voiceTtsType,
      elevenlabsKey: state.elevenlabsApiKey ? mask(state.elevenlabsApiKey) : "",
      elevenlabsKeySet: state.elevenlabsApiKey.length > 0,
      elevenlabsVoiceId: state.elevenlabsVoiceId,
      voiceAutoReply: state.voiceAutoReply,
      codeAgentEnabled: state.codeAgentEnabled,
      codeAgentModel: state.codeAgentModel,
      codeAgentMaxTurns: state.codeAgentMaxTurns,
      codeAgentTimeout: state.codeAgentTimeout,
      claudeAuthDetected: envStatus.claudeCredentials !== null,
      projectDir: process.cwd(),
    },
  });
}

async function handleValidateToken(req: Request): Promise<Response> {
  const body = (await req.json()) as { token?: string };
  if (!body.token) {
    return jsonResponse({ valid: false, error: "Token is required" }, 400);
  }
  const result = await validateTelegramToken(body.token);
  return jsonResponse(result);
}

async function handleSave(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    token?: string;
    userId?: string;
    language?: string;
    timezone?: string;
    model?: string;
    embeddingsEnabled?: boolean;
    openaiKey?: string;
    vaultEnabled?: boolean;
    vaultPath?: string;
    proactiveEnabled?: boolean;
    proactiveInterval?: number;
    proactiveCooldown?: number;
    quietHoursStart?: string;
    quietHoursEnd?: string;
    googleEnabled?: boolean;
    googleClientId?: string;
    googleClientSecret?: string;
    voiceSttEnabled?: boolean;
    geminiApiKey?: string;
    voiceTtsEnabled?: boolean;
    voiceTtsType?: string;
    elevenlabsApiKey?: string;
    elevenlabsVoiceId?: string;
    voiceAutoReply?: boolean;
    codeAgentEnabled?: boolean;
    codeAgentModel?: string;
    codeAgentMaxTurns?: number;
    codeAgentTimeout?: number;
  };

  // Fall back to existing .env values for secrets not re-entered
  const existingEnv = loadExistingEnv();
  const token = body.token || existingEnv.TELEGRAM_BOT_TOKEN || "";
  const openaiKey = body.openaiKey || existingEnv.OPENAI_API_KEY || "";
  const googleClientId = body.googleClientId || existingEnv.GOOGLE_CLIENT_ID || "";
  const googleClientSecret = body.googleClientSecret || existingEnv.GOOGLE_CLIENT_SECRET || "";
  const geminiApiKey = body.geminiApiKey || existingEnv.GEMINI_API_KEY || "";
  const elevenlabsApiKey = body.elevenlabsApiKey || existingEnv.ELEVENLABS_API_KEY || "";
  const elevenlabsVoiceId = body.elevenlabsVoiceId || existingEnv.ELEVENLABS_VOICE_ID || "";

  if (!token || !body.userId) {
    return jsonResponse({ success: false, message: "Token and User ID are required" }, 400);
  }

  // Check environment for sqlite-vec, Claude CLI, and OAuth credentials
  const envStatus = await checkEnvironment();

  const state: WizardState = {
    sqliteVecAvailable: envStatus.sqliteVecAvailable,
    claudeCliAvailable: envStatus.claudeCliAvailable,
    telegramToken: token,
    allowedUserId: body.userId,
    model: body.model || "claude-sonnet-4-5",
    language: body.language || "en",
    timezone: body.timezone || "UTC",
    embeddingEnabled: body.embeddingsEnabled ?? false,
    openaiKey,
    vaultEnabled: body.vaultEnabled ?? false,
    vaultPath: body.vaultPath || "",
    vaultInclude: [],
    vaultExclude: [],
    vaultWatchMode: "poll",
    vaultPollInterval: 60,
    proactiveEnabled: body.proactiveEnabled ?? false,
    proactiveInterval: body.proactiveInterval ?? 5,
    proactiveCooldown: body.proactiveCooldown ?? 15,
    quietHoursStart: body.quietHoursStart || "22:00",
    quietHoursEnd: body.quietHoursEnd || "08:00",
    googleEnabled: body.googleEnabled ?? false,
    googleClientId,
    googleClientSecret,
    voiceSttEnabled: body.voiceSttEnabled ?? false,
    geminiApiKey,
    voiceTtsEnabled: body.voiceTtsEnabled ?? false,
    voiceTtsType: (body.voiceTtsType || "elevenlabs") as "elevenlabs" | "gemini",
    elevenlabsApiKey,
    elevenlabsVoiceId,
    voiceAutoReply: body.voiceAutoReply ?? true,
    codeAgentEnabled: body.codeAgentEnabled ?? false,
    codeAgentModel: body.codeAgentModel || "sonnet",
    codeAgentMaxTurns: body.codeAgentMaxTurns ?? 50,
    codeAgentTimeout: body.codeAgentTimeout ?? 10,
    loggingFormat: "pretty",
    claudeCredentials: envStatus.claudeCredentials,
  };

  try {
    const ok = finalize(state);
    if (!ok) {
      return jsonResponse({ success: false, message: "Missing required fields" });
    }
    return jsonResponse({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ success: false, message: msg }, 500);
  }
}

async function handleDoctor(): Promise<Response> {
  const checks = await runDiagnostics();

  const passed = checks.filter((c) => c.status === "ok").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const errors = checks.filter((c) => c.status === "fail").length;
  const skipped = checks.filter((c) => c.status === "skip").length;

  const parts: string[] = [];
  parts.push(`${passed} passed`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);

  return jsonResponse({
    checks,
    summary: parts.join(", "),
  });
}

// ─── Google OAuth ────────────────────────────────────────────────

async function handleGoogleAuthUrl(req: Request): Promise<Response> {
  const body = (await req.json()) as { clientId?: string; clientSecret?: string };

  if (!body.clientId || !body.clientSecret) {
    return jsonResponse({ error: "Client ID and Secret are required" }, 400);
  }

  pendingOAuth = new GoogleOAuthClient({
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    redirectUri: `http://localhost:${serverPort}/oauth/callback`,
    tokenPath: "./data/google-tokens.json",
  });

  const url = pendingOAuth.generateAuthUrl();
  return jsonResponse({ url });
}

async function handleOAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code || !pendingOAuth) {
    return htmlResponse(
      "<h1>Error</h1><p>Missing authorization code or no pending OAuth flow.</p>",
    );
  }

  try {
    await pendingOAuth.exchangeCodeForTokens(code);
    return htmlResponse(`
      <html><body style="background:#1a1a2e;color:#e0e0e0;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h1 style="color:#4ade80">&#10003; Google Connected</h1>
          <p>You can close this tab and return to the setup wizard.</p>
        </div>
      </body></html>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return htmlResponse(`<h1>OAuth Error</h1><p>${msg}</p>`);
  }
}

function handleGoogleStatus(): Response {
  const connected = existsSync("./data/google-tokens.json");
  return jsonResponse({ connected });
}

// ─── Docker Status ───────────────────────────────────────────────

function handleDockerStatus(): Response {
  try {
    const proc = Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"], {
      timeout: 5000,
    });
    if (proc.exitCode === 0) {
      const version = proc.stdout.toString().trim();
      return jsonResponse({ available: true, version });
    }
    return jsonResponse({ available: false, error: "Docker not running" });
  } catch {
    return jsonResponse({ available: false, error: "Docker not found" });
  }
}

// ─── Platform Info ───────────────────────────────────────────────

function handlePlatformInfo(): Response {
  return jsonResponse({
    platform: process.platform,
    arch: process.arch,
  });
}

// ─── Pre-save Validation ─────────────────────────────────────────

interface PreValidateCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  blocking: boolean;
}

async function handlePreValidate(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const checks: PreValidateCheck[] = [];

  // Fall back to existing .env values for secrets not re-entered
  const existingEnv = loadExistingEnv();

  // 1. BLOCKING: Telegram token present + valid format
  const token = (body.token as string) || existingEnv.TELEGRAM_BOT_TOKEN || "";
  if (!token) {
    checks.push({
      name: "Telegram Token",
      status: "fail",
      message: "Bot token is required",
      blocking: true,
    });
  } else if (!validateTokenFormat(token)) {
    checks.push({
      name: "Telegram Token",
      status: "fail",
      message: "Token format is invalid",
      blocking: true,
    });
  } else {
    checks.push({
      name: "Telegram Token",
      status: "ok",
      message: "Token format valid",
      blocking: true,
    });
  }

  // 2. BLOCKING: User ID present and numeric
  const userId = (body.userId as string) || "";
  if (!userId) {
    checks.push({
      name: "User ID",
      status: "fail",
      message: "User ID is required",
      blocking: true,
    });
  } else if (!/^\d+$/.test(userId)) {
    checks.push({
      name: "User ID",
      status: "fail",
      message: "User ID must be numeric",
      blocking: true,
    });
  } else {
    checks.push({ name: "User ID", status: "ok", message: `User ID: ${userId}`, blocking: true });
  }

  // 3. BLOCKING: Claude CLI available
  const envStatus = await checkEnvironment();
  if (envStatus.claudeCliAvailable) {
    checks.push({
      name: "Claude CLI",
      status: "ok",
      message: `Claude CLI ${envStatus.claudeCliVersion}`,
      blocking: true,
    });
  } else {
    checks.push({
      name: "Claude CLI",
      status: "fail",
      message: "Claude CLI not found \u2014 the bot cannot start without it",
      blocking: true,
    });
  }

  // 4. BLOCKING: Claude credentials
  if (envStatus.claudeCredentials) {
    checks.push({
      name: "Claude Auth",
      status: "ok",
      message: "Credentials detected",
      blocking: true,
    });
  } else {
    checks.push({
      name: "Claude Auth",
      status: "fail",
      message: "Not authenticated \u2014 run 'claude login' in terminal",
      blocking: true,
    });
  }

  // 5. WARNING: OpenAI key if embeddings enabled
  if (body.embeddingsEnabled) {
    const openaiKey = (body.openaiKey as string) || existingEnv.OPENAI_API_KEY || "";
    if (!openaiKey) {
      checks.push({
        name: "OpenAI Key",
        status: "warn",
        message: "Embeddings enabled but no API key provided",
        blocking: false,
      });
    } else {
      checks.push({ name: "OpenAI Key", status: "ok", message: "Key provided", blocking: false });
    }
  }

  // 6. WARNING: Vault path if vault enabled
  if (body.vaultEnabled) {
    const vaultPath = (body.vaultPath as string) || "";
    if (!vaultPath) {
      checks.push({
        name: "Vault Path",
        status: "warn",
        message: "Vault enabled but no path specified",
        blocking: false,
      });
    } else if (existsSync(vaultPath)) {
      checks.push({
        name: "Vault Path",
        status: "ok",
        message: `Path exists: ${vaultPath}`,
        blocking: false,
      });
    } else {
      checks.push({
        name: "Vault Path",
        status: "warn",
        message: `Path not found: ${vaultPath}`,
        blocking: false,
      });
    }
  }

  // 7. WARNING: Docker if code agent enabled
  if (body.codeAgentEnabled) {
    try {
      const proc = Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"], {
        timeout: 5000,
      });
      if (proc.exitCode === 0) {
        checks.push({
          name: "Docker",
          status: "ok",
          message: `Docker v${proc.stdout.toString().trim()}`,
          blocking: false,
        });
      } else {
        checks.push({
          name: "Docker",
          status: "warn",
          message: "Docker not running \u2014 Code Agent will not work until Docker is available",
          blocking: false,
        });
      }
    } catch {
      checks.push({
        name: "Docker",
        status: "warn",
        message: "Docker not found \u2014 Code Agent requires Docker",
        blocking: false,
      });
    }
  }

  // 8. WARNING: Gemini key if voice enabled
  if (body.voiceSttEnabled) {
    const geminiKey = (body.geminiApiKey as string) || existingEnv.GEMINI_API_KEY || "";
    if (!geminiKey) {
      checks.push({
        name: "Gemini Key",
        status: "warn",
        message: "Voice enabled but no Gemini API key provided",
        blocking: false,
      });
    } else {
      checks.push({ name: "Gemini Key", status: "ok", message: "Key provided", blocking: false });
    }
  }

  // 9. WARNING: sqlite-vec if embeddings enabled
  if (body.embeddingsEnabled && !envStatus.sqliteVecAvailable) {
    checks.push({
      name: "sqlite-vec",
      status: "warn",
      message: "sqlite-vec not available \u2014 vector search will fall back to keyword search",
      blocking: false,
    });
  }

  const hasBlockingErrors = checks.some((c) => c.blocking && c.status === "fail");

  return jsonResponse({
    checks,
    canSave: !hasBlockingErrors,
    summary: hasBlockingErrors
      ? "Fix the errors above before saving"
      : "All critical checks passed",
  });
}

// ─── Vault Detection ─────────────────────────────────────────────

function isObsidianVault(dirPath: string): boolean {
  return existsSync(join(dirPath, ".obsidian"));
}

function handleDetectVaults(): Response {
  const home = homedir();
  const candidates: string[] = [];

  // macOS iCloud Obsidian
  const icloud = join(home, "Library/Mobile Documents/iCloud~md~obsidian/Documents");
  if (existsSync(icloud)) {
    try {
      for (const entry of readdirSync(icloud, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(join(icloud, entry.name));
        }
      }
    } catch {
      /* permission */
    }
  }

  // Common locations
  const commonPaths = [join(home, "Documents"), join(home, "Desktop"), home];
  for (const base of commonPaths) {
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const full = join(base, entry.name);
          if (isObsidianVault(full)) {
            candidates.push(full);
          }
        }
      }
    } catch {
      /* permission */
    }
  }

  // Deduplicate
  const vaults = [...new Set(candidates)].filter(isObsidianVault);
  return jsonResponse({ vaults });
}

// ─── i18n ───────────────────────────────────────────────────────

function handleLang(code: string | undefined): Response {
  if (!code || !/^[a-z]{2}$/.test(code)) {
    return jsonResponse({ error: "Invalid language code" }, 400);
  }
  const langPath = join(I18N_DIR, `${code}.json`);
  if (!existsSync(langPath)) {
    return jsonResponse({ error: "Language not found" }, 404);
  }
  const content = readFileSync(langPath, "utf-8");
  return new Response(content, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

// ─── Router ─────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // Serve static assets
  if (pathname === "/" && method === "GET") {
    return htmlResponse(getHtml());
  }
  if (pathname === "/style.css" && method === "GET") {
    return new Response(getCss(), {
      headers: { "Content-Type": "text/css", "Cache-Control": "public, max-age=3600" },
    });
  }
  if (pathname === "/app.js" && method === "GET") {
    return new Response(getJs(), {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // API routes — wrapped in try-catch to always return JSON on errors
  try {
    if (pathname === "/api/status" && method === "GET") {
      return await handleStatus();
    }

    if (pathname === "/api/validate-token" && method === "POST") {
      return await handleValidateToken(req);
    }

    if (pathname === "/api/save" && method === "POST") {
      return await handleSave(req);
    }

    if (pathname === "/api/doctor" && method === "GET") {
      return await handleDoctor();
    }

    if (pathname === "/api/detect-vaults" && method === "GET") {
      return handleDetectVaults();
    }

    if (pathname === "/api/google-auth-url" && method === "POST") {
      return await handleGoogleAuthUrl(req);
    }

    if (pathname === "/oauth/callback" && method === "GET") {
      return await handleOAuthCallback(req);
    }

    if (pathname === "/api/google-status" && method === "GET") {
      return handleGoogleStatus();
    }

    if (pathname === "/api/docker-status" && method === "GET") {
      return handleDockerStatus();
    }

    if (pathname === "/api/platform-info" && method === "GET") {
      return handlePlatformInfo();
    }

    if (pathname === "/api/pre-validate" && method === "POST") {
      return await handlePreValidate(req);
    }

    if (pathname.startsWith("/api/lang/") && method === "GET") {
      return handleLang(pathname.split("/").pop());
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[web-setup] ${method} ${pathname} error:`, msg);
    return jsonResponse({ error: msg }, 500);
  }

  return new Response("Not Found", { status: 404 });
}

// ─── Server Startup ─────────────────────────────────────────────

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Silently fail — user will see the URL in the terminal
  }
}

async function tryStartServer(port: number): Promise<boolean> {
  try {
    Bun.serve({
      port,
      fetch: handleRequest,
    });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let port = BASE_PORT;
  let started = false;

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    started = await tryStartServer(port);
    if (started) {
      serverPort = port;
      break;
    }
    port++;
  }

  if (!started) {
    console.error(`Could not start server on ports ${BASE_PORT}-${port}. All ports are busy.`);
    process.exit(1);
  }

  const url = `http://localhost:${port}`;

  console.log("");
  console.log("  \x1b[1mJustDoBot Setup\x1b[0m");
  console.log("");
  console.log(`  \x1b[32m→\x1b[0m ${url}`);
  console.log("");
  console.log("  Opening in your browser...");
  console.log("  Press Ctrl+C to stop the setup server.");
  console.log("");

  openBrowser(url);
}

main();
