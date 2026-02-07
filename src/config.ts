import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ─── Zod Schema ─────────────────────────────────────────────────

const Stage1ConfigSchema = z.object({
  bot: z.object({
    name: z.string().default("JustDoBot"),
    language: z.string().default("en"),
    timezone: z.string().default("UTC"),
  }),
  messenger: z.object({
    type: z.literal("telegram"),
    token: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    allowed_users: z.array(z.string()).min(1, "At least one allowed user required"),
    allowed_chats: z.array(z.string()).default([]),
    group_mode: z.enum(["mention_only", "all_messages"]).default("mention_only"),
    mode: z.enum(["polling"]).default("polling"),
  }),
  ai_engine: z.object({
    type: z.literal("claude-agent-sdk"),
    model: z
      .enum(["claude-opus-4-6", "claude-sonnet-4-5", "claude-haiku-4-5"])
      .default("claude-sonnet-4-5"),
    max_turns: z.number().default(10),
    allowed_tools: z.array(z.string()).default(["Read", "Grep", "Glob", "Write", "Edit"]),
    timeout_seconds: z.number().default(120),
    streaming: z.boolean().default(true),
  }),
  database: z.object({
    type: z.literal("sqlite"),
    path: z.string().default("./data/bot.db"),
  }),
  context: z.object({
    max_tokens: z.number().default(12000),
    session_timeout_hours: z.number().default(6),
    budget: z
      .object({
        recent_messages: z.number().default(0.4),
        memories: z.number().default(0.15),
        goals: z.number().default(0.07),
        vault_docs: z.number().default(0.25),
        check_in: z.number().default(0.05),
        reserve: z.number().default(0.08),
      })
      .default({}),
  }),
  streaming: z.object({
    enabled: z.boolean().default(true),
    edit_debounce_ms: z.number().default(1000),
    thinking_timeout_ms: z.number().default(2000),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    format: z.enum(["json", "pretty"]).default("json"),
  }),
  embedding: z
    .object({
      enabled: z.boolean().default(false),
      type: z.enum(["openai", "local"]).default("openai"),
      model: z.string().default("text-embedding-3-small"),
      dimensions: z.number().default(1536),
    })
    .default({}),
  backup: z
    .object({
      enabled: z.boolean().default(false),
      dir: z.string().default("./backups"),
    })
    .default({}),
  vault: z
    .object({
      enabled: z.boolean().default(false),
      type: z.enum(["obsidian"]).default("obsidian"),
      path: z.string().default(""),
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([]),
      watch_mode: z.enum(["poll", "native"]).default("poll"),
      poll_interval_seconds: z.number().default(60),
    })
    .default({}),
  proactive: z
    .object({
      enabled: z.boolean().default(false),
      check_interval_minutes: z.number().default(5),
      cooldown_minutes: z.number().default(15),
      reminder_cooldown_minutes: z.number().default(180),
      defer_minutes: z.number().default(5),
      quiet_hours: z
        .object({
          start: z.string().default("22:00"),
          end: z.string().default("08:00"),
        })
        .default({}),
    })
    .default({}),
  collectors: z
    .object({
      google: z
        .object({
          enabled: z.boolean().default(false),
          client_id: z.string().default(""),
          client_secret: z.string().default(""),
          gmail: z.object({ enabled: z.boolean().default(false) }).default({}),
          calendar: z.object({ enabled: z.boolean().default(false) }).default({}),
        })
        .default({}),
    })
    .default({}),
  voice: z
    .object({
      stt: z
        .object({
          enabled: z.boolean().default(false),
          type: z.enum(["gemini"]).default("gemini"),
          model: z.string().default("gemini-2.5-flash"),
        })
        .default({}),
      tts: z
        .object({
          enabled: z.boolean().default(false),
          type: z.enum(["elevenlabs", "gemini"]).default("elevenlabs"),
          voice_id: z.string().default(""),
          voice_name: z.string().default("Kore"),
          model: z.string().default("eleven_multilingual_v2"),
          gemini_model: z.string().default("gemini-2.5-flash-preview-tts"),
          auto_reply: z.boolean().default(true),
          max_text_length: z.number().default(4096),
        })
        .default({}),
      twilio: z
        .object({
          enabled: z.boolean().default(false),
          phone_number: z.string().default(""),
          user_phone_number: z.string().default(""),
          urgency_threshold: z.number().min(1).max(10).default(8),
        })
        .default({}),
    })
    .default({}),
  code_execution: z
    .object({
      enabled: z.boolean().default(false),
      sandbox_image: z.string().default("justdobot-sandbox:latest"),
      container_name: z.string().default("justdobot-sandbox"),
      proxy_image: z.string().default("ubuntu/squid:latest"),
      model: z.string().default("sonnet"),
      allowed_tools: z.array(z.string()).default(["Read", "Grep", "Glob", "Write", "Edit", "Bash"]),
      max_turns: z.number().min(5).max(200).default(50),
      max_concurrent_tasks: z.number().min(1).max(5).default(1),
      max_projects: z.number().min(1).max(50).default(10),
      timeout_minutes: z.number().min(1).max(60).default(10),
      append_system_prompt: z
        .string()
        .default(
          "You are running in an isolated Docker sandbox. " +
            "Pre-installed: Node.js 22, Bun, Python 3, Git, npm, pip. " +
            "Do NOT run apt-get, dpkg or install system packages — it will fail (all capabilities dropped). " +
            "For Python: always use `python3 -m venv .venv && source .venv/bin/activate` before pip install. " +
            "Global pip install will fail due to non-root user. " +
            "Internet is restricted to package registries (npm, pip, bun) and GitHub only.",
        ),
      resources: z
        .object({
          memory: z.string().default("4g"),
          cpus: z.string().default("2"),
          pids_limit: z.number().default(1024),
        })
        .default({}),
      network: z
        .object({
          internal_name: z.string().default("justdobot-sandbox-internal"),
          external_name: z.string().default("justdobot-sandbox-external"),
        })
        .default({}),
      allowed_domains: z
        .array(
          z.string().regex(/^\.[a-z0-9.-]+$/, "Domain must start with dot, e.g. '.example.com'"),
        )
        .default([
          ".anthropic.com",
          ".npmjs.org",
          ".npmjs.com",
          ".yarnpkg.com",
          ".pypi.org",
          ".pythonhosted.org",
          ".github.com",
          ".githubusercontent.com",
          ".githubassets.com",
          ".bun.sh",
          ".debian.org",
          ".ubuntu.com",
        ]),
      git: z
        .object({
          enabled: z.boolean().default(false),
          user_name: z.string().default("JustDoBot"),
          user_email: z.string().default(""),
          token: z.string().default(""),
        })
        .default({}),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof Stage1ConfigSchema>;
export type Stage1Config = AppConfig;

// ─── Env Resolution ─────────────────────────────────────────────

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
      const value = process.env[envVar];
      if (value === undefined) {
        throw new Error(`Environment variable ${envVar} is not set. Add it to .env or export it.`);
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  return obj;
}

// ─── Config Loader ──────────────────────────────────────────────

export function loadConfig(path = "config.yaml"): Stage1Config {
  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\nRun "bun run setup" to generate config.yaml and .env`,
    );
  }

  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw);
  const resolved = resolveEnvVars(parsed);

  const result = Stage1ConfigSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Config error in ${path}:\n${issues}\n\nRun "bun run setup" to fix.`);
  }
  return result.data;
}
