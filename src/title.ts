/**
 * Title generation command.
 *
 * Adds LLM-generated titles to transcripts.json entries that don't have them.
 * Can be run standalone or called from sync.
 */

import { join } from "path";
import { loadIndex, saveIndex } from "./utils/provenance.ts";
import { getAdapters } from "./adapters/index.ts";
import { renderTranscript } from "./render.ts";
import { renderTranscriptHtml } from "./render-html.ts";
import { generateTitle } from "./utils/openrouter.ts";
import {
  computeContentHash,
  loadCache,
  saveCache,
  getCachedTitle,
  type CacheEntry,
} from "./cache.ts";

export interface TitleOptions {
  outputDir: string;
  force?: boolean; // regenerate all titles, not just missing ones
  quiet?: boolean;
}

export interface TitleResult {
  generated: number;
  skipped: number;
  errors: number;
}

/**
 * Generate titles for transcripts.json entries that don't have them.
 */
export async function generateTitles(
  options: TitleOptions,
): Promise<TitleResult> {
  const { outputDir, force = false, quiet = false } = options;

  const result: TitleResult = { generated: 0, skipped: 0, errors: 0 };

  // Check for API key
  if (!process.env.OPENROUTER_API_KEY) {
    if (!quiet) {
      console.error("OPENROUTER_API_KEY not set, skipping title generation");
    }
    return result;
  }

  // Load index
  const index = await loadIndex(outputDir);
  const entries = Object.entries(index.entries);

  if (entries.length === 0) {
    if (!quiet) {
      console.error("No entries in transcripts.json");
    }
    return result;
  }

  // Get adapters for parsing
  const adapters = getAdapters();
  const adapterMap = new Map(adapters.map((a) => [a.name, a]));

  // Process entries that need titles
  for (const [filename, entry] of entries) {
    // Skip if already has title (unless force)
    if (entry.title && !force) {
      result.skipped++;
      continue;
    }

    try {
      // Read source and compute content hash
      const content = await Bun.file(entry.source).text();
      const contentHash = computeContentHash(content);

      // Check cache for existing title
      const cached = await loadCache(entry.source);
      const segmentIndex = entry.segmentIndex ? entry.segmentIndex - 1 : 0;
      const cachedTitle = getCachedTitle(cached, contentHash, segmentIndex);

      if (cachedTitle && !force) {
        // Use cached title
        entry.title = cachedTitle;
        result.skipped++;
        continue;
      }

      // Determine adapter from filename pattern (HTML files were synced with an adapter)
      // We need to find which adapter was used - check the source path
      let adapter = adapterMap.get("claude-code"); // default
      for (const a of adapters) {
        if (entry.source.includes(".claude/")) {
          adapter = a;
          break;
        }
      }

      if (!adapter) {
        console.error(`Warning: No adapter found for ${entry.source}`);
        result.errors++;
        continue;
      }

      const transcripts = adapter.parse(content, entry.source);

      // Find the right transcript (by segment index if applicable)
      const transcript = transcripts[segmentIndex];

      if (!transcript) {
        console.error(`Warning: Transcript not found for ${filename}`);
        result.errors++;
        continue;
      }

      // Render to markdown for title generation
      const markdown = renderTranscript(transcript);

      // Generate title
      const title = await generateTitle(markdown);

      if (title) {
        entry.title = title;
        result.generated++;
        if (!quiet) {
          console.error(`Title: ${filename} → ${title}`);
        }

        // Update cache with new title
        // Start fresh if content changed to avoid stale md/html
        const newCache: CacheEntry =
          cached?.contentHash === contentHash
            ? cached
            : { contentHash, segments: [] };
        // Ensure segment array is long enough
        while (newCache.segments.length <= segmentIndex) {
          newCache.segments.push({});
        }
        newCache.segments[segmentIndex].title = title;

        // Re-render HTML with title if this is an HTML file
        if (filename.endsWith(".html")) {
          const html = renderTranscriptHtml(transcript, { title });
          const outputPath = join(outputDir, filename);
          await Bun.write(outputPath, html);
          newCache.segments[segmentIndex].html = html;
        }

        await saveCache(entry.source, newCache);
      } else {
        result.skipped++;
        if (!quiet) {
          console.error(`Skip (no title generated): ${filename}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${filename}: ${message}`);
      result.errors++;
    }
  }

  // Save updated index
  await saveIndex(outputDir, index);

  // Summary
  if (!quiet) {
    console.error(
      `\nTitle generation complete: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors`,
    );
  }

  return result;
}
