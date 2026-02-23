import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import type { AppConfig } from "../src/config";
import { loadConfig } from "../src/config";

// ─── Types ──────────────────────────────────────────────────────

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  message: string;
}

// ─── ANSI Colors ────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function statusTag(status: DoctorCheck["status"]): string {
  switch (status) {
    case "ok":
      return `${GREEN}[OK]${RESET}  `;
    case "warn":
      return `${YELLOW}[WARN]${RESET}`;
    case "fail":
      return `${RED}[FAIL]${RESET}`;
    case "skip":
      return `${GRAY}[SKIP]${RESET}`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function countMdFiles(dir: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countMdFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        count++;
      }
    }
  } catch {
    // Permission denied or other FS error — skip silently
  }
  return count;
}

// ─── Diagnostics ────────────────────────────────────────────────

export async function runDiagnostics(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Bun version
  try {
    checks.push({
      name: "Bun",
      status: "ok",
      message: `Bun v${Bun.version}`,
    });
  } catch (err) {
    checks.push({
      name: "Bun",
      status: "fail",
      message: `Could not detect Bun: ${err}`,
    });
  }

  // 2. Claude CLI
  try {
    const proc = Bun.spawnSync(["claude", "--version"]);
    if (proc.exitCode === 0) {
      const version = proc.stdout.toString().trim();
      checks.push({
        name: "Claude CLI",
        status: "ok",
        message: `Claude CLI ${version}`,
      });
    } else {
      checks.push({
        name: "Claude CLI",
        status: "fail",
        message: "claude command found but returned non-zero exit code",
      });
    }
  } catch {
    checks.push({
      name: "Claude CLI",
      status: "fail",
      message:
        "claude command not found — install from https://docs.anthropic.com/en/docs/claude-cli",
    });
  }

  // 3. config.yaml
  let config: AppConfig | null = null;
  try {
    if (!existsSync("config.yaml")) {
      checks.push({
        name: "config.yaml",
        status: "fail",
        message: "config.yaml not found — run 'bun run setup' to create it",
      });
    } else {
      config = loadConfig("config.yaml");
      checks.push({
        name: "config.yaml",
        status: "ok",
        message: "config.yaml valid",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "config.yaml",
      status: "fail",
      message: `config.yaml invalid: ${msg}`,
    });
  }

  // 4. .env
  try {
    if (existsSync(".env")) {
      checks.push({
        name: ".env",
        status: "ok",
        message: ".env found",
      });
    } else {
      checks.push({
        name: ".env",
        status: "warn",
        message: ".env not found — environment variables must be set externally",
      });
    }
  } catch (err) {
    checks.push({
      name: ".env",
      status: "warn",
      message: `Could not check .env: ${err}`,
    });
  }

  // 5. TELEGRAM_BOT_TOKEN
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token && token.length > 0) {
      checks.push({
        name: "TELEGRAM_BOT_TOKEN",
        status: "ok",
        message: "TELEGRAM_BOT_TOKEN set",
      });
    } else {
      checks.push({
        name: "TELEGRAM_BOT_TOKEN",
        status: "fail",
        message: "TELEGRAM_BOT_TOKEN is not set or empty",
      });
    }
  } catch (err) {
    checks.push({
      name: "TELEGRAM_BOT_TOKEN",
      status: "fail",
      message: `Error checking TELEGRAM_BOT_TOKEN: ${err}`,
    });
  }

  // 6. ALLOWED_USER_ID
  try {
    const userId = process.env.ALLOWED_USER_ID;
    if (userId && userId.length > 0) {
      if (/^\d+$/.test(userId)) {
        checks.push({
          name: "ALLOWED_USER_ID",
          status: "ok",
          message: `ALLOWED_USER_ID = ${userId}`,
        });
      } else {
        checks.push({
          name: "ALLOWED_USER_ID",
          status: "fail",
          message: `ALLOWED_USER_ID is not numeric: "${userId}"`,
        });
      }
    } else {
      checks.push({
        name: "ALLOWED_USER_ID",
        status: "fail",
        message: "ALLOWED_USER_ID is not set or empty",
      });
    }
  } catch (err) {
    checks.push({
      name: "ALLOWED_USER_ID",
      status: "fail",
      message: `Error checking ALLOWED_USER_ID: ${err}`,
    });
  }

  // 7. Database
  try {
    const dbPath = config?.database?.path ?? "./data/bot.db";
    if (!existsSync(dbPath)) {
      checks.push({
        name: "Database",
        status: "fail",
        message: `Database file not found: ${dbPath}`,
      });
    } else {
      const db = new Database(dbPath, { readonly: true });
      try {
        const messages = db.query("SELECT COUNT(*) as count FROM messages").get() as {
          count: number;
        };
        const memories = db.query("SELECT COUNT(*) as count FROM memories").get() as {
          count: number;
        };
        const goals = db.query("SELECT COUNT(*) as count FROM goals").get() as {
          count: number;
        };
        checks.push({
          name: "Database",
          status: "ok",
          message: `Database: ${messages.count} messages, ${memories.count} memories, ${goals.count} goals`,
        });
      } finally {
        db.close();
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "Database",
      status: "fail",
      message: `Database error: ${msg}`,
    });
  }

  // 8. sqlite-vec
  try {
    // On macOS, try Homebrew SQLite for extension support
    if (process.platform === "darwin") {
      const brewPaths = [
        "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
        "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
      ];
      for (const p of brewPaths) {
        if (existsSync(p)) {
          try {
            Database.setCustomSQLite(p);
            break;
          } catch {
            // incompatible version — try next
          }
        }
      }
    }

    const testDb = new Database(":memory:");
    try {
      sqliteVec.load(testDb);
      checks.push({
        name: "sqlite-vec",
        status: "ok",
        message: "sqlite-vec extension loaded",
      });
    } finally {
      testDb.close();
    }
  } catch {
    checks.push({
      name: "sqlite-vec",
      status: "warn",
      message: "sqlite-vec not available — vector search will be disabled",
    });
  }

  // 9. Telegram API
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token.length === 0) {
      checks.push({
        name: "Telegram API",
        status: "skip",
        message: "Telegram API check skipped (no token)",
      });
    } else {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = (await resp.json()) as {
        ok: boolean;
        result?: { username: string };
        description?: string;
      };
      if (data.ok && data.result) {
        checks.push({
          name: "Telegram API",
          status: "ok",
          message: `Telegram bot: @${data.result.username}`,
        });
      } else {
        checks.push({
          name: "Telegram API",
          status: "fail",
          message: `Telegram API rejected token: ${data.description ?? "unknown error"}`,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "Telegram API",
      status: "fail",
      message: `Telegram API error: ${msg}`,
    });
  }

  // 10. Docker (Code Execution)
  try {
    const codeEnabled = config?.code_execution?.enabled ?? false;
    if (!codeEnabled) {
      checks.push({
        name: "Docker",
        status: "skip",
        message: "Code execution disabled",
      });
    } else {
      // Check Docker available
      const dockerProc = Bun.spawnSync(["docker", "info"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (dockerProc.exitCode !== 0) {
        checks.push({
          name: "Docker",
          status: "fail",
          message: "Docker is not available — install Docker and ensure it's running",
        });
      } else {
        checks.push({
          name: "Docker",
          status: "ok",
          message: "Docker available",
        });

        // Check sandbox image
        const imageName = config?.code_execution?.sandbox_image ?? "justdobot-sandbox:latest";
        const imageProc = Bun.spawnSync(["docker", "image", "inspect", imageName], {
          stdout: "pipe",
          stderr: "pipe",
        });
        if (imageProc.exitCode === 0) {
          checks.push({
            name: "Sandbox Image",
            status: "ok",
            message: `Sandbox image exists: ${imageName}`,
          });
        } else {
          checks.push({
            name: "Sandbox Image",
            status: "warn",
            message: `Sandbox image not found: ${imageName} — will be built on first run`,
          });
        }
      }

      // Check Claude credentials
      const homeDir = process.env.HOME ?? "";
      const credPath = `${homeDir}/.claude/.credentials.json`;
      const secretsCredPath = "./secrets/claude-credentials.json";
      const dockerEnvPath = "./secrets/.docker-env";
      const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
      const hasEnvB64 = !!process.env.CLAUDE_CREDENTIALS_B64;
      const hasSecretsCreds = existsSync(secretsCredPath);
      let hasDockerEnvB64 = false;
      if (existsSync(dockerEnvPath)) {
        try {
          const dockerEnv = readFileSync(dockerEnvPath, "utf-8");
          hasDockerEnvB64 = /^CLAUDE_CREDENTIALS_B64=.+/m.test(dockerEnv);
        } catch {
          // Ignore unreadable docker env file
        }
      }

      if (existsSync(credPath)) {
        checks.push({
          name: "Claude Credentials",
          status: "ok",
          message: "Claude credentials found for sandbox",
        });
      } else if (hasSecretsCreds || hasDockerEnvB64 || hasEnvB64) {
        checks.push({
          name: "Claude Credentials",
          status: "ok",
          message: "Claude credentials found in secrets/.docker-env (Docker injection mode)",
        });
      } else if (hasApiKey) {
        checks.push({
          name: "Claude Credentials",
          status: "ok",
          message: "ANTHROPIC_API_KEY set — will be passed to sandbox",
        });
      } else {
        checks.push({
          name: "Claude Credentials",
          status: "warn",
          message: "No Claude credentials or ANTHROPIC_API_KEY — sandbox may fail to authenticate",
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "Docker",
      status: "warn",
      message: `Docker check failed: ${msg}`,
    });
  }

  // 11. Vault
  try {
    const vaultEnabled = config?.vault?.enabled ?? false;
    if (!vaultEnabled) {
      checks.push({
        name: "Vault",
        status: "skip",
        message: "Vault integration disabled",
      });
    } else {
      const vaultPath = config?.vault?.path ?? "";
      if (!vaultPath || !existsSync(vaultPath)) {
        checks.push({
          name: "Vault",
          status: "warn",
          message: `Vault path does not exist: ${vaultPath || "(not configured)"}`,
        });
      } else {
        const stat = statSync(vaultPath);
        if (!stat.isDirectory()) {
          checks.push({
            name: "Vault",
            status: "warn",
            message: `Vault path is not a directory: ${vaultPath}`,
          });
        } else {
          const fileCount = countMdFiles(vaultPath);
          checks.push({
            name: "Vault",
            status: "ok",
            message: `Vault: ${vaultPath} (${fileCount} files)`,
          });
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "Vault",
      status: "warn",
      message: `Vault check failed: ${msg}`,
    });
  }

  return checks;
}

// ─── CLI Runner ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BOLD}JustDoBot Doctor${RESET}\n`);

  const checks = await runDiagnostics();

  for (const check of checks) {
    console.log(`  ${statusTag(check.status)} ${check.message}`);
  }

  const passed = checks.filter((c) => c.status === "ok").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const errors = checks.filter((c) => c.status === "fail").length;
  const skipped = checks.filter((c) => c.status === "skip").length;

  const parts: string[] = [];
  parts.push(`${GREEN}${passed} passed${RESET}`);
  if (warnings > 0) parts.push(`${YELLOW}${warnings} warning${warnings !== 1 ? "s" : ""}${RESET}`);
  if (skipped > 0) parts.push(`${GRAY}${skipped} skipped${RESET}`);
  parts.push(`${errors > 0 ? RED : GREEN}${errors} error${errors !== 1 ? "s" : ""}${RESET}`);

  console.log(`\n  Result: ${parts.join(", ")}\n`);

  process.exit(errors > 0 ? 1 : 0);
}

// Only run CLI when executed directly (not when imported by web-setup.ts)
if (import.meta.main) {
  main();
}
