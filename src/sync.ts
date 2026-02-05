/**
 * Sync command: batch export sessions to transcripts.
 *
 * Discovers session files in source directory, parses them,
 * and writes rendered output (markdown or HTML) to output directory.
 * Tracks provenance via transcripts.json index.
 */

import { dirname, join } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { getAdapters } from "./adapters/index.ts";
import type { Adapter, DiscoveredSession, Transcript } from "./types.ts";
import { renderTranscript } from "./render.ts";
import { renderTranscriptHtml } from "./render-html.ts";
import { renderIndex } from "./render-index.ts";
import { generateOutputName, extractSessionId } from "./utils/naming.ts";
import {
  loadIndex,
  saveIndex,
  setEntry,
  removeEntriesForSource,
  restoreEntries,
  deleteOutputFiles,
  normalizeSourcePath,
  extractFirstUserMessage,
  getOutputsForSource,
  type TranscriptsIndex,
} from "./utils/provenance.ts";
import { generateTitles } from "./title.ts";
import {
  computeContentHash,
  loadCache,
  saveCache,
  getCachedSegments,
  type CacheEntry,
  type SegmentCache,
} from "./cache.ts";

export type OutputFormat = "md" | "html";

export interface SyncOptions {
  source: string;
  output: string;
  format?: OutputFormat;
  noTitle?: boolean;
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
 * Render a transcript to the specified format.
 */
function renderToFormat(
  transcript: Transcript,
  format: OutputFormat,
  options: { sourcePath?: string; title?: string },
): Promise<string> {
  if (format === "html") {
    return renderTranscriptHtml(transcript, { title: options.title });
  }
  return Promise.resolve(
    renderTranscript(transcript, { sourcePath: options.sourcePath }),
  );
}

/**
 * Generate index.html for HTML output.
 */
async function writeIndexHtml(
  outputDir: string,
  index: TranscriptsIndex,
  quiet: boolean,
): Promise<void> {
  const indexHtml = renderIndex(index);
  const indexPath = join(outputDir, "index.html");
  await Bun.write(indexPath, indexHtml);
  if (!quiet) {
    console.error(`Generated: ${indexPath}`);
  }
}

/**
 * Sync session files from source to output directory.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const {
    source,
    output,
    format = "md",
    noTitle = false,
    force = false,
    quiet = false,
  } = options;

  const ext = format === "html" ? ".html" : ".md";
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
      // Read source and compute content hash
      const content = await Bun.file(session.path).text();
      const contentHash = computeContentHash(content);

      // Check cache
      const cached = await loadCache(sourcePath);
      const cachedSegments = getCachedSegments(cached, contentHash, format);

      // Check if we can use cached output
      const existingOutputs = getOutputsForSource(index, sourcePath);
      const outputsExist =
        existingOutputs.length > 0 &&
        existingOutputs.every((f) => existsSync(join(output, f)));

      if (!force && cachedSegments && outputsExist) {
        // Cache hit and outputs exist - skip
        if (!quiet) {
          console.error(`Skip (up to date): ${session.relativePath}`);
        }
        result.skipped++;
        continue;
      }

      // Need to sync: either cache miss, content changed, or force
      // Parse the source
      const transcripts = session.adapter.parse(content, session.path);

      // Remove entries from index (save for potential restoration on error)
      const removedEntries = removeEntriesForSource(index, sourcePath);

      // Track new outputs for this session
      const newOutputs: string[] = [];
      const sessionId = extractSessionId(session.path);

      // Build new cache entry
      const newCache: CacheEntry = {
        contentHash,
        segments: [],
      };

      try {
        // Generate fresh outputs for all transcripts
        for (let i = 0; i < transcripts.length; i++) {
          const transcript = transcripts[i];
          const segmentIndex = transcripts.length > 1 ? i + 1 : undefined;

          // Extract first user message
          const firstUserMessage = extractFirstUserMessage(transcript);

          // Generate deterministic name
          const baseName = generateOutputName(transcript, session.path);
          const suffix = segmentIndex ? `_${segmentIndex}` : "";
          const relativeDir = dirname(session.relativePath);
          const relativePath =
            relativeDir === "."
              ? `${baseName}${suffix}${ext}`
              : join(relativeDir, `${baseName}${suffix}${ext}`);
          const outputPath = join(output, relativePath);

          // Ensure output directory exists
          await mkdir(dirname(outputPath), { recursive: true });

          // Use title from: (1) harness-provided summary, (2) cache, (3) LLM later
          const title =
            session.summary ||
            (cached?.contentHash === contentHash
              ? cached.segments[i]?.title
              : undefined);

          // Render and write
          const rendered = await renderToFormat(transcript, format, {
            sourcePath,
            title,
          });
          await Bun.write(outputPath, rendered);
          newOutputs.push(relativePath);

          // Build segment cache
          const segmentCache: SegmentCache = { title };
          segmentCache[format] = rendered;
          newCache.segments.push(segmentCache);

          // Update index
          setEntry(index, relativePath, {
            source: sourcePath,
            sessionId,
            segmentIndex,
            syncedAt: new Date().toISOString(),
            firstUserMessage,
            title,
            messageCount: transcript.metadata.messageCount,
            startTime: transcript.metadata.startTime,
            endTime: transcript.metadata.endTime,
            cwd: transcript.metadata.cwd,
          });

          if (!quiet) {
            console.error(`Synced: ${outputPath}`);
          }
        }

        // Save cache
        await saveCache(sourcePath, newCache);

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

  // Generate titles for HTML format (unless --no-title)
  if (format === "html" && !noTitle) {
    if (!quiet) {
      console.error("\nGenerating titles...");
    }
    await generateTitles({ archiveDir: output, quiet });

    // Reload index after title generation and regenerate index.html
    const updatedIndex = await loadIndex(output);
    await writeIndexHtml(output, updatedIndex, quiet);
  } else if (format === "html") {
    // Generate index.html without titles
    const updatedIndex = await loadIndex(output);
    await writeIndexHtml(output, updatedIndex, quiet);
  }

  // Summary
  if (!quiet) {
    console.error(
      `\nSync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`,
    );
  }

  return result;
}
