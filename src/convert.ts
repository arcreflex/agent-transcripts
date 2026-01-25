/**
 * Convert command: full pipeline with provenance tracking.
 *
 * When output is a directory, uses provenance tracking via transcripts.json
 * index to manage output files.
 */

import { join } from "path";
import { mkdir } from "fs/promises";
import { parseToTranscripts } from "./parse.ts";
import { renderTranscript } from "./render.ts";
import { generateOutputName, extractSessionId } from "./utils/naming.ts";
import {
  loadIndex,
  saveIndex,
  removeEntriesForSource,
  restoreEntries,
  deleteOutputFiles,
  setEntry,
  normalizeSourcePath,
  extractFirstUserMessage,
} from "./utils/provenance.ts";

export interface ConvertToDirectoryOptions {
  input: string;
  outputDir: string;
  adapter?: string;
  head?: string;
}

/**
 * Convert source file to markdown in output directory.
 * Uses provenance tracking to replace existing outputs.
 */
export async function convertToDirectory(
  options: ConvertToDirectoryOptions,
): Promise<void> {
  const { input, outputDir, adapter, head } = options;

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Parse input to transcripts
  const { transcripts, inputPath } = await parseToTranscripts({
    input,
    adapter,
  });

  // Normalize source path for consistent index keys
  const sourcePath = normalizeSourcePath(inputPath);

  // Load index and handle existing outputs
  const index = await loadIndex(outputDir);

  // Remove old entries (save for restoration on error)
  const removedEntries =
    sourcePath !== "<stdin>" ? removeEntriesForSource(index, sourcePath) : [];

  const sessionId = extractSessionId(inputPath);
  const newOutputs: string[] = [];

  try {
    // Generate fresh outputs
    for (let i = 0; i < transcripts.length; i++) {
      const transcript = transcripts[i];
      const segmentIndex = transcripts.length > 1 ? i + 1 : undefined;

      // Generate deterministic name
      const baseName = generateOutputName(transcript, inputPath);
      const suffix = segmentIndex ? `_${segmentIndex}` : "";
      const relativePath = `${baseName}${suffix}.md`;
      const outputPath = join(outputDir, relativePath);

      // Render with provenance front matter
      const markdown = renderTranscript(transcript, {
        head,
        sourcePath: sourcePath !== "<stdin>" ? sourcePath : undefined,
      });
      await Bun.write(outputPath, markdown);
      newOutputs.push(relativePath);

      // Update index (only for non-stdin sources)
      if (sourcePath !== "<stdin>") {
        setEntry(index, relativePath, {
          source: sourcePath,
          sessionId,
          segmentIndex,
          syncedAt: new Date().toISOString(),
          firstUserMessage: extractFirstUserMessage(transcript),
          messageCount: transcript.metadata.messageCount,
          startTime: transcript.metadata.startTime,
          endTime: transcript.metadata.endTime,
          cwd: transcript.metadata.cwd,
        });
      }

      console.error(`Wrote: ${outputPath}`);
    }

    // Success: delete old output files (after new ones are written)
    const oldFilenames = removedEntries.map((e) => e.filename);
    const toDelete = oldFilenames.filter((f) => !newOutputs.includes(f));
    if (toDelete.length > 0) {
      await deleteOutputFiles(outputDir, toDelete);
    }
  } catch (error) {
    // Clean up any newly written files before restoring old entries
    if (newOutputs.length > 0) {
      await deleteOutputFiles(outputDir, newOutputs);
    }
    // Restore old entries on error to preserve provenance
    restoreEntries(index, removedEntries);
    throw error;
  }

  // Save index
  await saveIndex(outputDir, index);
}
