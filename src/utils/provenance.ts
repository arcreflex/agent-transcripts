/**
 * Provenance tracking utilities.
 *
 * Tracks the relationship between source files and output transcripts
 * via transcripts.json index (primary) and YAML front matter (for self-documenting files).
 */

import { join, resolve } from "path";
import { rename, unlink } from "fs/promises";

const INDEX_FILENAME = "transcripts.json";

// ============================================================================
// Index Types
// ============================================================================

export interface TranscriptEntry {
  source: string; // absolute path to source
  sessionId: string; // full session ID from source filename
  segmentIndex?: number; // for multi-transcript sources (1-indexed)
  syncedAt: string; // ISO timestamp
  firstUserMessage: string; // first user message content (for display)
  title?: string; // copied from cache for index.html convenience
  messageCount: number;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  cwd?: string;
}

export interface TranscriptsIndex {
  version: 1;
  entries: Record<string, TranscriptEntry>; // outputFilename → entry
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Normalize a source path to absolute for consistent index keys.
 */
export function normalizeSourcePath(sourcePath: string): string {
  if (sourcePath === "<stdin>") return sourcePath;
  return resolve(sourcePath);
}

// ============================================================================
// Index I/O
// ============================================================================

/**
 * Load transcripts.json index from output directory.
 * Returns empty index if file doesn't exist. Warns on corrupt file.
 */
export async function loadIndex(outputDir: string): Promise<TranscriptsIndex> {
  const indexPath = join(outputDir, INDEX_FILENAME);
  try {
    const content = await Bun.file(indexPath).text();
    const data = JSON.parse(content) as TranscriptsIndex;
    // Validate version
    if (data.version !== 1) {
      console.error(
        `Warning: Unknown index version ${data.version}, creating fresh index`,
      );
      return { version: 1, entries: {} };
    }
    return data;
  } catch (err) {
    // Distinguish between missing file (expected) and corrupt file (unexpected)
    const isEnoent =
      err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
    if (!isEnoent) {
      console.error(
        `Warning: Could not parse index file, starting fresh: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { version: 1, entries: {} };
  }
}

/**
 * Save transcripts.json index to output directory.
 * Uses atomic write (write to .tmp, then rename) to prevent corruption.
 */
export async function saveIndex(
  outputDir: string,
  index: TranscriptsIndex,
): Promise<void> {
  const indexPath = join(outputDir, INDEX_FILENAME);
  const tmpPath = `${indexPath}.tmp`;

  const content = JSON.stringify(index, null, 2) + "\n";
  await Bun.write(tmpPath, content);
  try {
    await rename(tmpPath, indexPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

// ============================================================================
// Index Operations
// ============================================================================

/**
 * Get all output filenames for a given source path.
 */
export function getOutputsForSource(
  index: TranscriptsIndex,
  sourcePath: string,
): string[] {
  const outputs: string[] = [];
  for (const [filename, entry] of Object.entries(index.entries)) {
    if (entry.source === sourcePath) {
      outputs.push(filename);
    }
  }
  return outputs;
}

/**
 * Set or update an entry in the index.
 * outputPath should be relative to the output directory.
 */
export function setEntry(
  index: TranscriptsIndex,
  outputPath: string,
  entry: TranscriptEntry,
): void {
  index.entries[outputPath] = entry;
}

/**
 * Remove all entries for a given source path.
 * Returns the removed entries (for potential restoration on error).
 */
export function removeEntriesForSource(
  index: TranscriptsIndex,
  sourcePath: string,
): Array<{ filename: string; entry: TranscriptEntry }> {
  const removed: Array<{ filename: string; entry: TranscriptEntry }> = [];
  for (const [filename, entry] of Object.entries(index.entries)) {
    if (entry.source === sourcePath) {
      removed.push({ filename, entry });
      delete index.entries[filename];
    }
  }
  return removed;
}

/**
 * Restore previously removed entries to the index.
 */
export function restoreEntries(
  index: TranscriptsIndex,
  entries: Array<{ filename: string; entry: TranscriptEntry }>,
): void {
  for (const { filename, entry } of entries) {
    index.entries[filename] = entry;
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Delete output files, with warnings on failure.
 */
export async function deleteOutputFiles(
  outputDir: string,
  filenames: string[],
  quiet = false,
): Promise<void> {
  for (const filename of filenames) {
    const fullPath = join(outputDir, filename);
    try {
      await unlink(fullPath);
      if (!quiet) {
        console.error(`Deleted: ${fullPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: could not delete ${fullPath}: ${msg}`);
    }
  }
}

// ============================================================================
// Transcript Metadata Extraction
// ============================================================================

import type { Transcript } from "../types.ts";

/**
 * Extract the first user message from a transcript.
 * Returns empty string if no user message found.
 */
export function extractFirstUserMessage(transcript: Transcript): string {
  for (const msg of transcript.messages) {
    if (msg.type === "user") {
      return msg.content;
    }
  }
  return "";
}
