import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMemoryProvider } from "../../src/plugins/database/sqlite/index";
import { VaultIndexer } from "../../src/plugins/vault/obsidian/indexer";

let db: SqliteMemoryProvider;
let vaultPath: string;

beforeEach(async () => {
  db = new SqliteMemoryProvider();
  await db.init({ database: { path: ":memory:" } } as Record<string, unknown>);
  vaultPath = await mkdtemp(join(tmpdir(), "vault-test-"));
});

afterEach(async () => {
  await db.destroy();
  await rm(vaultPath, { recursive: true, force: true });
});

function createIndexer(include: string[] = [], exclude: string[] = []): VaultIndexer {
  return new VaultIndexer(
    { vaultPath, include, exclude },
    {
      vaultRepo: db.getVaultRepo(),
      vecRepo: db.getVecRepo(),
      embeddingProvider: null,
    },
  );
}

describe("VaultIndexer", () => {
  test("indexAll on empty directory returns 0", async () => {
    const indexer = createIndexer();
    const count = await indexer.indexAll();
    expect(count).toBe(0);
  });

  test("indexAll indexes .md files", async () => {
    const dir = join(vaultPath, "AI-Tools");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "tool1.md"), "# Tool 1\n\nDescription of tool 1.");
    await writeFile(join(dir, "tool2.md"), "# Tool 2\n\nDescription of tool 2.");

    const indexer = createIndexer(["AI-Tools"]);
    const count = await indexer.indexAll();
    expect(count).toBe(2); // Each file short enough for 1 chunk
    expect(db.getVaultRepo().getDocumentCount()).toBe(2);
  });

  test("skips excluded directories", async () => {
    const included = join(vaultPath, "AI-Tools");
    const excluded = join(vaultPath, ".obsidian");
    await mkdir(included, { recursive: true });
    await mkdir(excluded, { recursive: true });
    await writeFile(join(included, "note.md"), "# Note\n\nContent.");
    await writeFile(join(excluded, "config.md"), "# Config\n\nShould be excluded.");

    const indexer = createIndexer(["AI-Tools"], [".obsidian"]);
    const count = await indexer.indexAll();
    expect(count).toBe(1);
  });

  test("respects include filter", async () => {
    const included = join(vaultPath, "Books");
    const notIncluded = join(vaultPath, "Random");
    await mkdir(included, { recursive: true });
    await mkdir(notIncluded, { recursive: true });
    await writeFile(join(included, "book.md"), "# Book\n\nContent.");
    await writeFile(join(notIncluded, "random.md"), "# Random\n\nNot included.");

    const indexer = createIndexer(["Books"]);
    const count = await indexer.indexAll();
    expect(count).toBe(1);
  });

  test("incremental index skips unchanged files", async () => {
    const dir = join(vaultPath, "AI-Tools");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "note.md"), "# Note\n\nOriginal content.");

    const indexer = createIndexer(["AI-Tools"]);

    // First index
    const count1 = await indexer.indexAll();
    expect(count1).toBe(1);

    // Second index — same content, should skip
    const count2 = await indexer.indexAll();
    expect(count2).toBe(0);
  });

  test("re-indexes changed files", async () => {
    const dir = join(vaultPath, "AI-Tools");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "note.md");
    await writeFile(filePath, "# Note\n\nOriginal content.");

    const indexer = createIndexer(["AI-Tools"]);
    await indexer.indexAll();

    // Modify file content
    await writeFile(filePath, "# Note\n\nUpdated content with new info.");

    const count = await indexer.indexAll();
    expect(count).toBe(1);

    const docs = db.getVaultRepo().getDocumentsByPath("AI-Tools/note.md");
    expect(docs[0].content).toContain("Updated content");
  });

  test("removeFile deletes from index", async () => {
    const dir = join(vaultPath, "AI-Tools");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "note.md");
    await writeFile(filePath, "# Note\n\nContent.");

    const indexer = createIndexer(["AI-Tools"]);
    await indexer.indexAll();
    expect(db.getVaultRepo().getDocumentCount()).toBe(1);

    await indexer.removeFile(filePath);
    expect(db.getVaultRepo().getDocumentCount()).toBe(0);
  });
});
