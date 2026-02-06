import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import {
  archiveSession,
  archiveAll,
  loadEntry,
  saveEntry,
  listEntries,
  isFresh,
  computeContentHash,
  type ArchiveEntry,
} from "../src/archive.ts";
import type { Adapter } from "../src/types.ts";
import { claudeCodeAdapter } from "../src/adapters/claude-code.ts";

const fixturesDir = join(import.meta.dir, "fixtures/claude");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "archive-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("computeContentHash", () => {
  it("returns consistent hash", () => {
    const h1 = computeContentHash("hello");
    const h2 = computeContentHash("hello");
    expect(h1).toBe(h2);
  });

  it("returns different hash for different content", () => {
    const h1 = computeContentHash("hello");
    const h2 = computeContentHash("world");
    expect(h1).not.toBe(h2);
  });
});

describe("saveEntry / loadEntry", () => {
  it("round-trips an entry", async () => {
    const entry: ArchiveEntry = {
      sessionId: "test-session",
      sourcePath: "/tmp/test.jsonl",
      sourceHash: "abc123",
      adapterName: "claude-code",
      adapterVersion: "claude-code:1",
      schemaVersion: 1,
      archivedAt: "2025-01-01T00:00:00Z",
      transcripts: [],
    };

    await saveEntry(tmpDir, entry);
    const loaded = await loadEntry(tmpDir, "test-session");
    expect(loaded).toEqual(entry);
  });

  it("returns undefined for missing entry", async () => {
    const loaded = await loadEntry(tmpDir, "nonexistent");
    expect(loaded).toBeUndefined();
  });
});

describe("isFresh", () => {
  const adapter: Adapter = {
    name: "test",
    version: "test:1",
    discover: async () => [],
    parse: () => [],
  };

  const entry: ArchiveEntry = {
    sessionId: "s",
    sourcePath: "/tmp/s.jsonl",
    sourceHash: "hash1",
    adapterName: "test",
    adapterVersion: "test:1",
    schemaVersion: 1,
    archivedAt: "2025-01-01T00:00:00Z",
    transcripts: [],
  };

  it("returns true when all match", () => {
    expect(isFresh(entry, "hash1", adapter)).toBe(true);
  });

  it("returns false when sourceHash differs", () => {
    expect(isFresh(entry, "hash2", adapter)).toBe(false);
  });

  it("returns false when adapterVersion differs", () => {
    const v2 = { ...adapter, version: "test:2" };
    expect(isFresh(entry, "hash1", v2)).toBe(false);
  });

  it("returns false when schemaVersion differs", () => {
    const oldSchema = { ...entry, schemaVersion: 0 };
    expect(isFresh(oldSchema, "hash1", adapter)).toBe(false);
  });
});

describe("archiveSession", () => {
  it("archives a fixture file", async () => {
    const fixturePath = join(fixturesDir, "basic-conversation.input.jsonl");
    const session = {
      path: fixturePath,
      relativePath: "basic-conversation.input.jsonl",
      mtime: Date.now(),
    };

    const { entry, updated } = await archiveSession(
      tmpDir,
      session,
      claudeCodeAdapter,
    );

    expect(updated).toBe(true);
    expect(entry.sessionId).toBe("basic-conversation.input");
    expect(entry.adapterName).toBe("claude-code");
    expect(entry.adapterVersion).toBe("claude-code:1");
    expect(entry.schemaVersion).toBe(1);
    expect(entry.transcripts.length).toBeGreaterThan(0);
    expect(entry.sourceHash).toBeTruthy();

    // Verify it was persisted
    const loaded = await loadEntry(tmpDir, entry.sessionId);
    expect(loaded).toEqual(entry);
  });

  it("returns updated: false for unchanged source", async () => {
    const fixturePath = join(fixturesDir, "basic-conversation.input.jsonl");
    const session = {
      path: fixturePath,
      relativePath: "basic-conversation.input.jsonl",
      mtime: Date.now(),
    };

    const first = await archiveSession(tmpDir, session, claudeCodeAdapter);
    expect(first.updated).toBe(true);

    const second = await archiveSession(tmpDir, session, claudeCodeAdapter);
    expect(second.updated).toBe(false);
  });

  it("updates title when harness summary changes on fresh entry", async () => {
    const fixturePath = join(fixturesDir, "basic-conversation.input.jsonl");

    // Archive without summary
    const first = await archiveSession(
      tmpDir,
      { path: fixturePath, relativePath: "x", mtime: Date.now() },
      claudeCodeAdapter,
    );
    expect(first.entry.title).toBeUndefined();

    // Re-archive with a new harness summary (same content hash)
    const second = await archiveSession(
      tmpDir,
      {
        path: fixturePath,
        relativePath: "x",
        mtime: Date.now(),
        summary: "New harness title",
      },
      claudeCodeAdapter,
    );
    expect(second.updated).toBe(true);
    expect(second.entry.title).toBe("New harness title");

    // Verify persisted
    const loaded = await loadEntry(tmpDir, first.entry.sessionId);
    expect(loaded?.title).toBe("New harness title");
  });

  it("preserves existing title when re-archiving", async () => {
    const fixturePath = join(fixturesDir, "basic-conversation.input.jsonl");
    const session = {
      path: fixturePath,
      relativePath: "basic-conversation.input.jsonl",
      mtime: Date.now(),
    };

    // Archive once
    const { entry } = await archiveSession(tmpDir, session, claudeCodeAdapter);

    // Manually set a title and save
    entry.title = "My Custom Title";
    await saveEntry(tmpDir, entry);

    // Force re-archive by bumping adapter version
    const bumpedAdapter = { ...claudeCodeAdapter, version: "claude-code:2" };
    const { entry: reArchived, updated } = await archiveSession(
      tmpDir,
      session,
      bumpedAdapter,
    );

    expect(updated).toBe(true);
    expect(reArchived.title).toBe("My Custom Title");
  });
});

describe("listEntries", () => {
  it("returns all entries", async () => {
    const fixtures = [
      "basic-conversation.input.jsonl",
      "with-tools.input.jsonl",
    ];

    for (const f of fixtures) {
      await archiveSession(
        tmpDir,
        {
          path: join(fixturesDir, f),
          relativePath: f,
          mtime: Date.now(),
        },
        claudeCodeAdapter,
      );
    }

    const entries = await listEntries(tmpDir);
    expect(entries.length).toBe(2);
    const ids = entries.map((e) => e.sessionId).sort();
    expect(ids).toEqual(
      ["basic-conversation.input", "with-tools.input"].sort(),
    );
  });

  it("returns empty array for nonexistent dir", async () => {
    const entries = await listEntries("/tmp/nonexistent-archive-dir-xyz");
    expect(entries).toEqual([]);
  });
});

describe("archiveAll", () => {
  it("discovers and archives sessions", async () => {
    // Create a source dir with a fixture and a sessions-index.json
    const sourceDir = await mkdtemp(join(tmpdir(), "archive-source-"));
    const fixturePath = join(fixturesDir, "basic-conversation.input.jsonl");
    const content = await Bun.file(fixturePath).text();
    await Bun.write(join(sourceDir, "test-session.jsonl"), content);

    const result = await archiveAll(tmpDir, sourceDir, [claudeCodeAdapter], {
      quiet: true,
    });

    expect(result.updated.length).toBe(1);
    expect(result.errors.length).toBe(0);

    // Second run should be all current
    const result2 = await archiveAll(tmpDir, sourceDir, [claudeCodeAdapter], {
      quiet: true,
    });
    expect(result2.updated.length).toBe(0);
    expect(result2.current.length).toBe(1);

    await rm(sourceDir, { recursive: true, force: true });
  });
});
