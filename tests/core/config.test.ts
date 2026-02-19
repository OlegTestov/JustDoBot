import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";

function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "justdobot-test-"));
  const configPath = join(dir, "config.yaml");
  writeFileSync(configPath, content);
  return configPath;
}

const dirs: string[] = [];
function tracked(path: string): string {
  dirs.push(path.replace(/\/config\.yaml$/, ""));
  return path;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

const MINIMAL_VALID = `
bot: {}
messenger:
  type: telegram
  token: "123456:ABCDEF"
  allowed_users: ["999"]
ai_engine:
  type: claude-agent-sdk
database:
  type: sqlite
context: {}
streaming: {}
logging: {}
`;

describe("loadConfig", () => {
  test("throws when config file does not exist", () => {
    expect(() => loadConfig("/nonexistent/config.yaml")).toThrow("Config file not found");
  });

  test("parses minimal valid config with defaults", () => {
    const path = tracked(writeTempConfig(MINIMAL_VALID));
    const config = loadConfig(path);

    expect(config.bot.name).toBe("JustDoBot");
    expect(config.bot.language).toBe("en");
    expect(config.bot.timezone).toBe("UTC");
    expect(config.messenger.token).toBe("123456:ABCDEF");
    expect(config.messenger.allowed_users).toEqual(["999"]);
    expect(config.ai_engine.model).toBe("claude-sonnet-4-6");
    expect(config.ai_engine.max_turns).toBe(10);
    expect(config.database.path).toBe("./data/bot.db");
    expect(config.context.max_tokens).toBe(12000);
    expect(config.streaming.enabled).toBe(true);
    expect(config.logging.level).toBe("info");
    expect(config.embedding.enabled).toBe(false);
    expect(config.vault.enabled).toBe(false);
    expect(config.proactive.enabled).toBe(false);
    expect(config.code_execution.enabled).toBe(false);
  });

  test("rejects config without required messenger token", () => {
    const yaml = `
messenger:
  type: telegram
  token: ""
  allowed_users: ["1"]
ai_engine:
  type: claude-agent-sdk
database:
  type: sqlite
`;
    const path = tracked(writeTempConfig(yaml));
    expect(() => loadConfig(path)).toThrow("messenger.token");
  });

  test("rejects config without allowed_users", () => {
    const yaml = `
messenger:
  type: telegram
  token: "123:ABC"
  allowed_users: []
ai_engine:
  type: claude-agent-sdk
database:
  type: sqlite
`;
    const path = tracked(writeTempConfig(yaml));
    expect(() => loadConfig(path)).toThrow("allowed_users");
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal
  test("resolves ${ENV_VAR} in string values", () => {
    const original = process.env.TEST_BOT_TOKEN;
    process.env.TEST_BOT_TOKEN = "resolved-token-value";
    try {
      const yaml = `
bot: {}
messenger:
  type: telegram
  token: "\${TEST_BOT_TOKEN}"
  allowed_users: ["1"]
ai_engine:
  type: claude-agent-sdk
database:
  type: sqlite
context: {}
streaming: {}
logging: {}
`;
      const path = tracked(writeTempConfig(yaml));
      const config = loadConfig(path);
      expect(config.messenger.token).toBe("resolved-token-value");
    } finally {
      if (original === undefined) delete process.env.TEST_BOT_TOKEN;
      else process.env.TEST_BOT_TOKEN = original;
    }
  });

  test("throws on unset environment variable", () => {
    delete process.env.NONEXISTENT_VAR_XYZ;
    const yaml = `
messenger:
  type: telegram
  token: "\${NONEXISTENT_VAR_XYZ}"
  allowed_users: ["1"]
ai_engine:
  type: claude-agent-sdk
database:
  type: sqlite
`;
    const path = tracked(writeTempConfig(yaml));
    expect(() => loadConfig(path)).toThrow("NONEXISTENT_VAR_XYZ");
  });

  test("applies custom values over defaults", () => {
    const yaml = `
bot:
  name: MyBot
  language: ru
  timezone: Europe/Moscow
messenger:
  type: telegram
  token: "123:ABC"
  allowed_users: ["1", "2"]
ai_engine:
  type: claude-agent-sdk
  model: claude-opus-4-6
  max_turns: 10
  timeout_seconds: 120
database:
  type: sqlite
  path: "./custom/path.db"
context:
  max_tokens: 8000
  session_timeout_hours: 2
streaming: {}
logging:
  level: debug
  format: pretty
`;
    const path = tracked(writeTempConfig(yaml));
    const config = loadConfig(path);

    expect(config.bot.name).toBe("MyBot");
    expect(config.bot.language).toBe("ru");
    expect(config.bot.timezone).toBe("Europe/Moscow");
    expect(config.messenger.allowed_users).toEqual(["1", "2"]);
    expect(config.ai_engine.model).toBe("claude-opus-4-6");
    expect(config.ai_engine.max_turns).toBe(10);
    expect(config.database.path).toBe("./custom/path.db");
    expect(config.context.max_tokens).toBe(8000);
    expect(config.logging.level).toBe("debug");
    expect(config.logging.format).toBe("pretty");
  });

  test("validates code_execution allowed_domains format", () => {
    const yaml = `
messenger:
  type: telegram
  token: "123:ABC"
  allowed_users: ["1"]
ai_engine:
  type: claude-agent-sdk
database:
  type: sqlite
code_execution:
  enabled: true
  allowed_domains: ["invalid-no-dot.com"]
`;
    const path = tracked(writeTempConfig(yaml));
    expect(() => loadConfig(path)).toThrow("allowed_domains");
  });
});
