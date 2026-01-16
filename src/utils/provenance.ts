/**
 * Provenance tracking utilities.
 *
 * Tracks the relationship between source files and output transcripts
 * via YAML front matter, enabling update-in-place behavior.
 */

import { Glob } from "bun";
import { join } from "path";
import { stat, unlink } from "fs/promises";

/**
 * Extract source path from YAML front matter.
 * Returns null if no front matter or no source field.
 */
export function extractSourceFromFrontMatter(content: string): string | null {
  // Match YAML front matter at start of file
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  // Extract source field (simple line-based parsing)
  const frontMatter = match[1];
  const sourceLine = frontMatter
    .split("\n")
    .find((line) => line.startsWith("source:"));
  if (!sourceLine) return null;

  return sourceLine.replace(/^source:\s*/, "").trim();
}

/**
 * Scan output directory for existing transcripts.
 * Returns map from absolute source path → all output file paths for that source.
 */
export async function scanOutputDirectory(
  outputDir: string,
): Promise<Map<string, string[]>> {
  const sourceToOutputs = new Map<string, string[]>();
  const glob = new Glob("**/*.md");

  for await (const file of glob.scan({ cwd: outputDir, absolute: false })) {
    const fullPath = join(outputDir, file);
    try {
      const content = await Bun.file(fullPath).text();
      const sourcePath = extractSourceFromFrontMatter(content);
      if (sourcePath) {
        const existing = sourceToOutputs.get(sourcePath) || [];
        existing.push(fullPath);
        sourceToOutputs.set(sourcePath, existing);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return sourceToOutputs;
}

/**
 * Find existing outputs for a specific source path.
 */
export async function findExistingOutputs(
  outputDir: string,
  sourcePath: string,
): Promise<string[]> {
  const allOutputs = await scanOutputDirectory(outputDir);
  return allOutputs.get(sourcePath) || [];
}

/**
 * Delete existing output files, with warnings on failure.
 */
export async function deleteExistingOutputs(
  paths: string[],
  quiet = false,
): Promise<void> {
  for (const oldPath of paths) {
    try {
      await unlink(oldPath);
      if (!quiet) {
        console.error(`Deleted: ${oldPath}`);
      }
    } catch (err) {
      // Warn but continue - file may already be gone or have permission issues
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: could not delete ${oldPath}: ${msg}`);
    }
  }
}

/**
 * Check if any outputs are stale relative to source mtime.
 */
export async function hasStaleOutputs(
  existingOutputs: string[],
  expectedCount: number,
  sourceMtime: number,
): Promise<boolean> {
  if (existingOutputs.length !== expectedCount) return true;

  for (const outputPath of existingOutputs) {
    try {
      const outputStat = await stat(outputPath);
      if (outputStat.mtime.getTime() < sourceMtime) {
        return true;
      }
    } catch {
      // Output doesn't exist
      return true;
    }
  }

  return false;
}
