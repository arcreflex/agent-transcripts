/**
 * Archive module: persistent storage for parsed transcripts.
 *
 * Archive entries live at {archiveDir}/{sessionId}.json and contain
 * the full parsed transcripts plus metadata for freshness checks.
 */

import { join } from "path";
import { homedir } from "os";
import { mkdir, readdir, rename, unlink } from "fs/promises";
import type { Adapter, DiscoveredSession, Transcript } from "./types.ts";
import { extractSessionId } from "./utils/naming.ts";

export const DEFAULT_ARCHIVE_DIR = join(
  homedir(),
  ".local/share/agent-transcripts/archive",
);

const ARCHIVE_SCHEMA_VERSION = 1;

export interface ArchiveEntry {
  sessionId: string;
  sourcePath: string;
  sourceHash: string;
  adapterName: string;
  adapterVersion: string;
  schemaVersion: number;
  archivedAt: string;
  title?: string;
  transcripts: Transcript[];
}

export interface ArchiveResult {
  updated: string[];
  current: string[];
  errors: Array<{ sessionId: string; error: string }>;
}

export function computeContentHash(content: string): string {
  return Bun.hash(content).toString(16);
}

export async function loadEntry(
  archiveDir: string,
  sessionId: string,
): Promise<ArchiveEntry | undefined> {
  try {
    const content = await Bun.file(
      join(archiveDir, `${sessionId}.json`),
    ).text();
    return JSON.parse(content) as ArchiveEntry;
  } catch {
    return undefined;
  }
}

export async function saveEntry(
  archiveDir: string,
  entry: ArchiveEntry,
): Promise<void> {
  await mkdir(archiveDir, { recursive: true });

  const filePath = join(archiveDir, `${entry.sessionId}.json`);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(entry, null, 2) + "\n";

  await Bun.write(tmpPath, content);
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {}
    throw err;
  }
}

export function isFresh(
  entry: ArchiveEntry,
  sourceHash: string,
  adapter: Adapter,
): boolean {
  return (
    entry.sourceHash === sourceHash &&
    entry.adapterVersion === adapter.version &&
    entry.schemaVersion === ARCHIVE_SCHEMA_VERSION
  );
}

export async function archiveSession(
  archiveDir: string,
  session: DiscoveredSession,
  adapter: Adapter,
): Promise<{ entry: ArchiveEntry; updated: boolean }> {
  const sessionId = extractSessionId(session.path);
  const content = await Bun.file(session.path).text();
  const sourceHash = computeContentHash(content);

  const existing = await loadEntry(archiveDir, sessionId);
  if (existing && isFresh(existing, sourceHash, adapter)) {
    // Still update title if harness summary changed
    if (session.summary && existing.title !== session.summary) {
      existing.title = session.summary;
      await saveEntry(archiveDir, existing);
      return { entry: existing, updated: true };
    }
    return { entry: existing, updated: false };
  }

  const transcripts = adapter.parse(content, session.path);

  const entry: ArchiveEntry = {
    sessionId,
    sourcePath: session.path,
    sourceHash,
    adapterName: adapter.name,
    adapterVersion: adapter.version,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    archivedAt: new Date().toISOString(),
    title: session.summary ?? existing?.title,
    transcripts,
  };

  await saveEntry(archiveDir, entry);
  return { entry, updated: true };
}

export async function archiveAll(
  archiveDir: string,
  sourceDir: string,
  adapters: Adapter[],
  options: { quiet?: boolean } = {},
): Promise<ArchiveResult> {
  const result: ArchiveResult = { updated: [], current: [], errors: [] };

  for (const adapter of adapters) {
    const sessions = await adapter.discover(sourceDir);

    for (const session of sessions) {
      const sessionId = extractSessionId(session.path);
      try {
        const { updated } = await archiveSession(archiveDir, session, adapter);
        if (updated) {
          result.updated.push(sessionId);
          if (!options.quiet) {
            console.error(`Archived: ${sessionId}`);
          }
        } else {
          result.current.push(sessionId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ sessionId, error: message });
        if (!options.quiet) {
          console.error(`Error archiving ${sessionId}: ${message}`);
        }
      }
    }
  }

  return result;
}

export async function listEntries(archiveDir: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];

  let files: string[];
  try {
    files = await readdir(archiveDir);
  } catch {
    return entries;
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = await Bun.file(join(archiveDir, file)).text();
      entries.push(JSON.parse(content) as ArchiveEntry);
    } catch {
      // Skip corrupt entries
    }
  }

  return entries;
}
