import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { ArchiveWatcher } from "../src/watch.ts";
import { claudeCodeAdapter } from "../src/adapters/claude-code.ts";
import { listEntries } from "../src/archive.ts";

const fixturesDir = join(import.meta.dir, "fixtures/claude");

let archiveDir: string;
let sourceDir: string;

beforeEach(async () => {
  archiveDir = await mkdtemp(join(tmpdir(), "watch-archive-"));
  sourceDir = await mkdtemp(join(tmpdir(), "watch-source-"));
});

afterEach(async () => {
  await rm(archiveDir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

describe("ArchiveWatcher with SourceSpec[]", () => {
  it("archives from a single source spec on initial scan", async () => {
    // Copy a fixture into the source dir
    const content = await Bun.file(
      join(fixturesDir, "basic-conversation.input.jsonl"),
    ).text();
    await Bun.write(join(sourceDir, "session.jsonl"), content);

    const updates: string[] = [];
    const watcher = new ArchiveWatcher(
      [{ adapter: claudeCodeAdapter, source: sourceDir }],
      {
        archiveDir,
        quiet: true,
        onUpdate(result) {
          updates.push(...result.updated);
        },
      },
    );

    await watcher.start();
    watcher.stop();

    expect(updates.length).toBe(1);
    const entries = await listEntries(archiveDir);
    expect(entries.length).toBe(1);
  });

  it("archives from multiple source specs", async () => {
    const sourceDir2 = await mkdtemp(join(tmpdir(), "watch-source2-"));

    const content = await Bun.file(
      join(fixturesDir, "basic-conversation.input.jsonl"),
    ).text();
    await Bun.write(join(sourceDir, "a.jsonl"), content);
    await Bun.write(join(sourceDir2, "b.jsonl"), content);

    const updates: string[] = [];
    const watcher = new ArchiveWatcher(
      [
        { adapter: claudeCodeAdapter, source: sourceDir },
        { adapter: claudeCodeAdapter, source: sourceDir2 },
      ],
      {
        archiveDir,
        quiet: true,
        onUpdate(result) {
          updates.push(...result.updated);
        },
      },
    );

    await watcher.start();
    watcher.stop();

    expect(updates.length).toBe(2);
    const entries = await listEntries(archiveDir);
    expect(entries.length).toBe(2);

    await rm(sourceDir2, { recursive: true, force: true });
  });
});
