/**
 * Sync command: batch export sessions to markdown transcripts.
 *
 * Discovers session files in source directory, parses them,
 * and writes rendered markdown to output directory.
 * Tracks provenance via transcripts.json index.
 */

import { dirname, join } from "path";
import { mkdir } from "fs/promises";
import { getAdapters } from "./adapters/index.ts";
import type { Adapter, DiscoveredSession } from "./types.ts";
import { renderTranscript } from "./render.ts";
import { generateOutputName, extractSessionId } from "./utils/naming.ts";
import {
  loadIndex,
  saveIndex,
  isStale,
  setEntry,
  removeEntriesForSource,
  restoreEntries,
  deleteOutputFiles,
  normalizeSourcePath,
} from "./utils/provenance.ts";

export interface SyncOptions {
  source: string;
  output: string;
  force?: boolean;
  quiet?: boolean;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}

interface SessionFile extends DiscoveredSession {
  adapter: Adapter;
}

/**
 * Sync session files from source to output directory.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { source, output, force = false, quiet = false } = options;

  const result: SyncResult = { synced: 0, skipped: 0, errors: 0 };

  // Ensure output directory exists
  await mkdir(output, { recursive: true });

  // Load index
  const index = await loadIndex(output);
  if (!quiet && Object.keys(index.entries).length > 0) {
    console.error(
      `Found ${Object.keys(index.entries).length} existing transcript(s) in index`,
    );
  }

  // Discover sessions from all adapters
  const sessions: SessionFile[] = [];
  for (const adapter of getAdapters()) {
    const discovered = await adapter.discover(source);
    for (const session of discovered) {
      sessions.push({ ...session, adapter });
    }
  }

  if (!quiet) {
    console.error(`Found ${sessions.length} session file(s)`);
  }

  // Process each session
  for (const session of sessions) {
    // Normalize source path for consistent index keys
    const sourcePath = normalizeSourcePath(session.path);

    try {
      // Read and parse using the adapter that discovered this file
      const content = await Bun.file(session.path).text();
      const transcripts = session.adapter.parse(content, session.path);

      // Check if sync needed (force or stale)
      const needsUpdate =
        force ||
        isStale(index, sourcePath, session.mtime, transcripts.length, output);

      if (!needsUpdate) {
        if (!quiet) {
          console.error(`Skip (up to date): ${session.relativePath}`);
        }
        result.skipped++;
        continue;
      }

      // Remove entries from index (save for potential restoration on error)
      const removedEntries = removeEntriesForSource(index, sourcePath);

      // Track new outputs for this session
      const newOutputs: string[] = [];
      const sessionId = extractSessionId(session.path);

      try {
        // Generate fresh outputs for all transcripts
        for (let i = 0; i < transcripts.length; i++) {
          const transcript = transcripts[i];
          const segmentIndex = transcripts.length > 1 ? i + 1 : undefined;

          // Generate deterministic name
          const baseName = generateOutputName(transcript, session.path);
          const suffix = segmentIndex ? `_${segmentIndex}` : "";
          const relativeDir = dirname(session.relativePath);
          const relativePath =
            relativeDir === "."
              ? `${baseName}${suffix}.md`
              : join(relativeDir, `${baseName}${suffix}.md`);
          const outputPath = join(output, relativePath);

          // Ensure output directory exists
          await mkdir(dirname(outputPath), { recursive: true });

          // Render with provenance front matter and write
          const markdown = renderTranscript(transcript, {
            sourcePath,
          });
          await Bun.write(outputPath, markdown);
          newOutputs.push(relativePath);

          // Update index
          setEntry(index, relativePath, {
            source: sourcePath,
            sourceMtime: session.mtime,
            sessionId,
            segmentIndex,
            syncedAt: new Date().toISOString(),
          });

          if (!quiet) {
            console.error(`Synced: ${outputPath}`);
          }
        }

        // Success: delete old output files (after new ones are written)
        const oldFilenames = removedEntries.map((e) => e.filename);
        // Only delete files that aren't being reused
        const toDelete = oldFilenames.filter((f) => !newOutputs.includes(f));
        if (toDelete.length > 0) {
          await deleteOutputFiles(output, toDelete, quiet);
        }

        result.synced++;
      } catch (error) {
        // Clean up any newly written files before restoring old entries
        if (newOutputs.length > 0) {
          await deleteOutputFiles(output, newOutputs, quiet);
        }
        // Restore old entries on error to preserve provenance
        restoreEntries(index, removedEntries);
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${session.relativePath}: ${message}`);
      result.errors++;
    }
  }

  // Save index
  await saveIndex(output, index);

  // Summary
  if (!quiet) {
    console.error(
      `\nSync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`,
    );
  }

  return result;
}
