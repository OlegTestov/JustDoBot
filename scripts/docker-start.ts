import { existsSync, mkdirSync, renameSync } from "node:fs";
import { detectClaudeCredentials, saveClaudeCredentials } from "./setup-core";

const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";

function runCommand(command: string[], label: string): void {
  const proc = Bun.spawnSync(command, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  if (proc.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${proc.exitCode}`);
  }
}

function runCommandOptional(command: string[], label: string): void {
  const proc = Bun.spawnSync(command, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (proc.exitCode !== 0) {
    console.log(`${label} exited with code ${proc.exitCode} (continuing).`);
  }
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function validateAndRefreshCredentials(
  creds: NonNullable<Awaited<ReturnType<typeof detectClaudeCredentials>>>,
): Promise<{
  ok: boolean;
  refreshed?: NonNullable<Awaited<ReturnType<typeof detectClaudeCredentials>>>;
  reason?: string;
}> {
  if (!creds.refreshToken) {
    return { ok: false, reason: "Refresh token is missing." };
  }

  try {
    const response = await fetch(CLAUDE_OAUTH_REFRESH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        scope: (creds.scopes || []).join(" "),
      }),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    } | null;

    if (!response.ok || !payload?.access_token) {
      return {
        ok: false,
        reason:
          payload?.error_description ??
          payload?.error ??
          `Refresh endpoint returned status ${response.status}.`,
      };
    }

    const refreshed = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? creds.refreshToken,
      expiresAt:
        typeof payload.expires_in === "number"
          ? Date.now() + payload.expires_in * 1000
          : creds.expiresAt,
      scopes:
        typeof payload.scope === "string" && payload.scope.trim().length > 0
          ? payload.scope.split(/\s+/)
          : creds.scopes,
    };

    return { ok: true, refreshed };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Unknown refresh validation error.",
    };
  }
}

function ensureClaudeCli(): void {
  const proc = Bun.spawnSync(["claude", "--version"]);
  if (proc.exitCode !== 0) {
    throw new Error("Claude CLI is not installed. Run: npm install -g @anthropic-ai/claude-code");
  }
}

async function ensureClaudeCredentials(): Promise<void> {
  ensureClaudeCli();

  let creds = await detectClaudeCredentials();

  if (!creds) {
    console.log("Claude credentials not found. Starting 'claude login'...");
    runCommand(["claude", "login"], "claude login");
    creds = await detectClaudeCredentials();
  }

  if (!creds) {
    throw new Error("Claude credentials are still unavailable after login.");
  }

  let validation = await validateAndRefreshCredentials(creds);
  if (!validation.ok && isInteractiveTerminal()) {
    console.log(`Detected invalid Claude credentials (${validation.reason ?? "unknown reason"}).`);
    console.log("Starting full auth reset: 'claude logout' -> 'claude login'...");
    runCommandOptional(["claude", "logout"], "claude logout");
    runCommand(["claude", "login"], "claude login");

    creds = await detectClaudeCredentials();
    if (!creds) {
      throw new Error("Claude credentials not found after re-login.");
    }
    validation = await validateAndRefreshCredentials(creds);
  }

  if (!validation.ok || !validation.refreshed) {
    throw new Error(
      `Claude credentials are invalid for Docker usage: ${validation.reason ?? "refresh failed"}. Try 'claude logout && claude login' and rerun.`,
    );
  }

  saveClaudeCredentials(validation.refreshed);
  console.log("Claude credentials validated and saved to secrets/");
}

function migrateCredentialsFromData(): void {
  if (existsSync("data/claude-credentials.json")) {
    if (!existsSync("secrets")) {
      mkdirSync("secrets", { recursive: true });
    }
    renameSync("data/claude-credentials.json", "secrets/claude-credentials.json");
    console.log("Migrated credentials from data/ to secrets/");
  }
}

async function main(): Promise<void> {
  migrateCredentialsFromData();
  await ensureClaudeCredentials();
  runCommand(["docker", "compose", "up", "-d", "--build", "--remove-orphans"], "docker compose up");
  console.log("Docker stack is up.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`docker-start failed: ${message}`);
  process.exit(1);
});
