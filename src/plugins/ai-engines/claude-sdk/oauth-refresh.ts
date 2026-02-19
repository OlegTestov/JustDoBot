import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { getLogger } from "../../../core/logger";

const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
const MIN_DELAY_MS = 30 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

type ClaudeOauthPayload = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
};

type StoredClaudeCredentials = {
  claudeAiOauth: ClaudeOauthPayload;
};

function parseCredentials(raw: string): StoredClaudeCredentials | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClaudeCredentials>;
    const oauth = parsed?.claudeAiOauth;
    if (!oauth?.accessToken || typeof oauth.accessToken !== "string") {
      return null;
    }
    return {
      claudeAiOauth: {
        accessToken: oauth.accessToken,
        refreshToken: typeof oauth.refreshToken === "string" ? oauth.refreshToken : null,
        expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
        scopes: Array.isArray(oauth.scopes)
          ? oauth.scopes.filter((s): s is string => typeof s === "string")
          : ["user:inference"],
      },
    };
  } catch {
    return null;
  }
}

function ensureParentDir(filePath: string): void {
  const idx = filePath.lastIndexOf("/");
  if (idx <= 0) return;
  const dir = filePath.slice(0, idx);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeJsonAtomic(filePath: string, data: unknown, mode = 0o600): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode });
  try {
    chmodSync(tempPath, mode);
  } catch {
    // Some FS/OS combinations may ignore chmod; best effort only.
  }
  renameSync(tempPath, filePath);
  try {
    chmodSync(filePath, mode);
  } catch {
    // Keep best effort; do not fail refresh solely on chmod.
  }
}

export function injectClaudeCredentialsFromData(options?: {
  sourcePath?: string;
  targetPath?: string;
}): boolean {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CREDENTIALS_B64) {
    return false;
  }

  const sourcePath = options?.sourcePath ?? "./secrets/claude-credentials.json";
  const home = process.env.HOME || "/home/botuser";
  const targetPath = options?.targetPath ?? `${home}/.claude/.credentials.json`;

  if (!existsSync(sourcePath)) {
    return false;
  }

  const raw = readFileSync(sourcePath, "utf-8");
  const parsed = parseCredentials(raw);
  if (!parsed) {
    getLogger().warn({ sourcePath }, "Claude credentials file is malformed");
    return false;
  }

  writeJsonAtomic(targetPath, parsed);
  return true;
}

export class ClaudeOAuthRefreshManager {
  private readonly sourcePath: string;
  private readonly targetPath: string;
  private readonly clientId: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = MIN_DELAY_MS;
  private refreshing = false;
  private stopped = false;
  private authFailed = false;
  private onRefresh?: (credentialsJson: string) => void;
  private onAuthFailed?: (reason: string) => void;

  constructor(options?: {
    sourcePath?: string;
    targetPath?: string;
    clientId?: string;
  }) {
    const home = process.env.HOME || "/home/botuser";
    this.sourcePath = options?.sourcePath ?? "./secrets/claude-credentials.json";
    this.targetPath = options?.targetPath ?? `${home}/.claude/.credentials.json`;
    this.clientId = options?.clientId ?? process.env.CLAUDE_OAUTH_CLIENT_ID ?? DEFAULT_CLIENT_ID;
  }

  start(): void {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      getLogger().info("OAuth refresh manager disabled: CLAUDE_CODE_OAUTH_TOKEN is set");
      return;
    }
    this.stopped = false;
    this.scheduleNext();
  }

  setOnRefresh(cb: (credentialsJson: string) => void): void {
    this.onRefresh = cb;
  }

  setOnAuthFailed(cb: (reason: string) => void): void {
    this.onAuthFailed = cb;
  }

  isAuthFailed(): boolean {
    return this.authFailed;
  }

  clearAuthFailed(): void {
    this.authFailed = false;
    this.retryDelayMs = MIN_DELAY_MS;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const delay = Math.max(1_000, Math.min(ms, MAX_DELAY_MS));
    this.timer = setTimeout(() => {
      void this.refreshIfNeeded();
    }, delay);
  }

  private scheduleNext(): void {
    const creds = this.readCurrentCredentials();
    if (!creds || !creds.claudeAiOauth.refreshToken) {
      // Poll slowly until credentials appear.
      this.schedule(15 * 60 * 1000);
      return;
    }

    const expiresAt = creds.claudeAiOauth.expiresAt ?? Date.now() + 60 * 60 * 1000;
    const delay = expiresAt - Date.now() - REFRESH_AHEAD_MS;
    this.schedule(Math.max(MIN_DELAY_MS, delay));
  }

  private scheduleRetry(): void {
    const jitter = Math.floor(Math.random() * 5_000);
    this.schedule(this.retryDelayMs + jitter);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 15 * 60 * 1000);
  }

  private readCurrentCredentials(): StoredClaudeCredentials | null {
    const primaryPath = existsSync(this.targetPath) ? this.targetPath : this.sourcePath;
    if (!existsSync(primaryPath)) {
      return null;
    }

    const raw = readFileSync(primaryPath, "utf-8");
    return parseCredentials(raw);
  }

  private async refreshIfNeeded(): Promise<void> {
    if (this.stopped || this.refreshing) return;
    const logger = getLogger();
    this.refreshing = true;
    try {
      const creds = this.readCurrentCredentials();
      if (!creds) {
        this.retryDelayMs = MIN_DELAY_MS;
        this.scheduleNext();
        return;
      }

      const oauth = creds.claudeAiOauth;
      if (!oauth.refreshToken) {
        logger.warn("OAuth refresh disabled: refresh token missing in credentials");
        this.schedule(30 * 60 * 1000);
        return;
      }

      const now = Date.now();
      const expiresAt = oauth.expiresAt ?? 0;
      if (expiresAt > now + REFRESH_AHEAD_MS) {
        this.retryDelayMs = MIN_DELAY_MS;
        this.scheduleNext();
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(REFRESH_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: oauth.refreshToken,
            client_id: this.clientId,
            scope: oauth.scopes.join(" "),
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as
          | {
              access_token?: string;
              refresh_token?: string;
              expires_in?: number;
              scope?: string;
            }
          | { error?: string; error_description?: string };

        if (!response.ok || !("access_token" in payload) || !payload.access_token) {
          const errCode = "error" in payload ? payload.error : undefined;
          const errDescription =
            "error_description" in payload ? payload.error_description : undefined;
          logger.warn(
            { status: response.status, errCode, errDescription },
            "OAuth token refresh failed",
          );

          if (errCode === "invalid_grant") {
            this.authFailed = true;
            const reason = errDescription || "Refresh token expired or revoked";
            logger.error({ reason }, "OAuth refresh token is permanently invalid");
            this.onAuthFailed?.(reason);
            this.schedule(MAX_DELAY_MS);
            return;
          }

          this.scheduleRetry();
          return;
        }

        const scopeList =
          typeof payload.scope === "string" && payload.scope.trim().length > 0
            ? payload.scope.split(/\s+/)
            : oauth.scopes;

        const nextCredentials: StoredClaudeCredentials = {
          claudeAiOauth: {
            accessToken: payload.access_token,
            refreshToken: payload.refresh_token ?? oauth.refreshToken,
            expiresAt:
              typeof payload.expires_in === "number"
                ? Date.now() + payload.expires_in * 1000
                : oauth.expiresAt,
            scopes: scopeList,
          },
        };

        writeJsonAtomic(this.targetPath, nextCredentials);
        this.onRefresh?.(JSON.stringify(nextCredentials, null, 2));

        logger.info("OAuth access token refreshed");
        this.authFailed = false;
        this.retryDelayMs = MIN_DELAY_MS;
        this.scheduleNext();
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      getLogger().warn({ err }, "OAuth refresh scheduler failed");
      this.scheduleRetry();
    } finally {
      this.refreshing = false;
    }
  }
}
