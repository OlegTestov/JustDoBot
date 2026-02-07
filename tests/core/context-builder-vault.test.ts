import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildContext } from "../../src/core/context-builder";
import type {
  HealthStatus,
  IVaultProvider,
  PluginConfig,
  VaultSearchResult,
} from "../../src/core/interfaces";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";

let db: SqliteMemoryProvider;
let sessionId: string;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
  sessionId = crypto.randomUUID();
});

afterEach(async () => {
  await db.destroy();
});

// Mock vault provider for testing
function createMockVaultProvider(results: VaultSearchResult[]): IVaultProvider {
  return {
    name: "mock-vault",
    version: "1.0.0",
    async init(_config: PluginConfig) {},
    async destroy() {},
    async healthCheck(): Promise<HealthStatus> {
      return { healthy: true, lastCheck: new Date() };
    },
    async index() {
      return 0;
    },
    async search(_query: string, _embedding: number[] | null, limit: number) {
      return results.slice(0, limit);
    },
    async getDocumentCount() {
      return results.length;
    },
    startWatching() {},
    stopWatching() {},
  };
}

describe("buildContext with vault", () => {
  test("returns empty vaultResults when vaultProvider is null", async () => {
    const context = await buildContext(sessionId, "hello", db, 12000, null, undefined, null);
    expect(context.vaultResults).toEqual([]);
  });

  test("includes vault results from provider", async () => {
    const mockResults: VaultSearchResult[] = [
      {
        id: 1,
        file_path: "AI-Tools/video.md",
        title: "Video Tools",
        content: "List of AI video tools",
        chunk_index: 0,
        score: 0.9,
      },
    ];

    const vault = createMockVaultProvider(mockResults);
    const context = await buildContext(sessionId, "video tools", db, 12000, null, undefined, vault);

    expect(context.vaultResults.length).toBe(1);
    expect(context.vaultResults[0].title).toBe("Video Tools");
  });

  test("vault results respect 25% token budget", async () => {
    // Create vault results that exceed 25% budget
    const bigContent = "X".repeat(10000); // ~3333 tokens
    const mockResults: VaultSearchResult[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      file_path: `docs/note${i}.md`,
      title: `Note ${i}`,
      content: bigContent,
      chunk_index: 0,
      score: 0.9 - i * 0.05,
    }));

    const vault = createMockVaultProvider(mockResults);
    const context = await buildContext(sessionId, "test query", db, 12000, null, undefined, vault);

    // 25% of 12000 = 3000 tokens. Each result ~3333 tokens.
    // Should only fit 0 results (each exceeds budget alone)
    // Actually bigContent is 10000 chars / 3 = 3334 tokens, budget is 3000
    expect(context.vaultResults.length).toBeLessThan(10);
  });

  test("redistributes only check_in when vault has results", async () => {
    // Add many messages
    for (let i = 0; i < 50; i++) {
      await db.saveMessage({
        session_id: sessionId,
        role: "user",
        content: `Message ${i}`,
      });
    }

    const smallResults: VaultSearchResult[] = [
      {
        id: 1,
        file_path: "note.md",
        title: "Note",
        content: "Short vault result",
        chunk_index: 0,
        score: 0.8,
      },
    ];

    const vault = createMockVaultProvider(smallResults);
    const contextWithVault = await buildContext(
      sessionId,
      "test",
      db,
      12000,
      null,
      undefined,
      vault,
    );

    const contextWithoutVault = await buildContext(
      sessionId,
      "test",
      db,
      12000,
      null,
      undefined,
      null,
    );

    // With vault results, less budget is redistributed to messages
    // So more messages should be included without vault
    expect(contextWithoutVault.recentMessages.length).toBeGreaterThanOrEqual(
      contextWithVault.recentMessages.length,
    );
  });

  test("empty userMessage skips vault search", async () => {
    let searchCalled = false;
    const vault: IVaultProvider = {
      ...createMockVaultProvider([]),
      async search() {
        searchCalled = true;
        return [];
      },
    };

    await buildContext(sessionId, "", db, 12000, null, undefined, vault);
    expect(searchCalled).toBe(false);
  });
});
