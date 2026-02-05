/**
 * Title generation: add LLM-generated titles to archive entries.
 */

import {
  listEntries,
  saveEntry,
  DEFAULT_ARCHIVE_DIR,
  type ArchiveEntry,
} from "./archive.ts";
import { renderTranscript } from "./render.ts";
import { generateTitle } from "./utils/openrouter.ts";

export interface TitleOptions {
  archiveDir?: string;
  force?: boolean;
  quiet?: boolean;
}

export interface TitleResult {
  generated: number;
  skipped: number;
  errors: number;
}

export async function generateTitles(
  options: TitleOptions,
): Promise<TitleResult> {
  const {
    archiveDir = DEFAULT_ARCHIVE_DIR,
    force = false,
    quiet = false,
  } = options;

  const result: TitleResult = { generated: 0, skipped: 0, errors: 0 };

  if (!process.env.OPENROUTER_API_KEY) {
    if (!quiet) {
      console.error("OPENROUTER_API_KEY not set, skipping title generation");
    }
    return result;
  }

  const entries = await listEntries(archiveDir);

  if (entries.length === 0) {
    if (!quiet) {
      console.error("No entries in archive");
    }
    return result;
  }

  for (const entry of entries) {
    if (entry.title && !force) {
      result.skipped++;
      continue;
    }

    try {
      // Use the first transcript for title generation
      const transcript = entry.transcripts[0];
      if (!transcript || transcript.metadata.messageCount === 0) {
        result.skipped++;
        continue;
      }

      const markdown = renderTranscript(transcript);
      const title = await generateTitle(markdown);

      if (title) {
        entry.title = title;
        await saveEntry(archiveDir, entry);
        result.generated++;
        if (!quiet) {
          console.error(`Title: ${entry.sessionId} → ${title}`);
        }
      } else {
        result.skipped++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${entry.sessionId}: ${message}`);
      result.errors++;
    }
  }

  if (!quiet) {
    console.error(
      `\nTitle generation: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors`,
    );
  }

  return result;
}
