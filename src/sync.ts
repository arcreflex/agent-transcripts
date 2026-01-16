/**
 * Sync command: batch export sessions to markdown transcripts.
 *
 * Discovers session files in source directory, parses them,
 * and writes rendered markdown to output directory.
 * Uses LLM-generated descriptive names when API key is available.
 * Tracks provenance via YAML front matter to correlate updates.
 */

import { Glob } from "bun";
import { dirname, join } from "path";
import { mkdir, stat, unlink } from "fs/promises";
import { getAdapters } from "./adapters/index.ts";
import type { Adapter } from "./types.ts";
import { renderTranscript } from "./render.ts";
import { generateOutputName, type NamingOptions } from "./utils/naming.ts";

export interface SyncOptions {
  source: string;
  output: string;
  force?: boolean;
  quiet?: boolean;
  naming?: NamingOptions;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}

interface SessionFile {
  path: string;
  relativePath: string;
  mtime: number;
  adapter: Adapter;
}

/**
 * Extract source path from YAML front matter.
 * Returns null if no front matter or no source field.
 */
function extractSourceFromFrontMatter(content: string): string | null {
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
async function scanOutputDirectory(
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
 * Discover session files for a specific adapter.
 */
async function discoverForAdapter(
  source: string,
  adapter: Adapter,
): Promise<SessionFile[]> {
  const sessions: SessionFile[] = [];

  for (const pattern of adapter.filePatterns) {
    const glob = new Glob(`**/${pattern}`);

    for await (const file of glob.scan({ cwd: source, absolute: false })) {
      const fullPath = join(source, file);

      try {
        const fileStat = await stat(fullPath);
        sessions.push({
          path: fullPath,
          relativePath: file,
          mtime: fileStat.mtime.getTime(),
          adapter,
        });
      } catch {
        // Skip files we can't stat
      }
    }
  }

  return sessions;
}

/**
 * Check if outputs need to be re-rendered.
 * Returns true if: force flag, count mismatch, or any output is stale.
 */
async function needsSync(
  existingOutputs: string[],
  expectedCount: number,
  sourceMtime: number,
  force: boolean,
): Promise<boolean> {
  if (force) return true;
  if (existingOutputs.length !== expectedCount) return true;

  for (const outputPath of existingOutputs) {
    try {
      const outputStat = await stat(outputPath);
      if (outputStat.mtime.getTime() < sourceMtime) {
        return true;
      }
    } catch {
      // Output doesn't exist, needs sync
      return true;
    }
  }

  return false;
}

/**
 * Sync session files from source to output directory.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { source, output, force = false, quiet = false, naming } = options;

  const result: SyncResult = { synced: 0, skipped: 0, errors: 0 };

  // Scan output directory for existing transcripts (source → output paths)
  const existingOutputs = await scanOutputDirectory(output);
  if (!quiet && existingOutputs.size > 0) {
    const totalFiles = [...existingOutputs.values()].reduce(
      (sum, paths) => sum + paths.length,
      0,
    );
    console.error(
      `Found ${totalFiles} existing transcript(s) from ${existingOutputs.size} source(s)`,
    );
  }

  // Discover sessions for each adapter
  const sessions: SessionFile[] = [];
  for (const adapter of getAdapters()) {
    const adapterSessions = await discoverForAdapter(source, adapter);
    sessions.push(...adapterSessions);
  }

  if (!quiet) {
    console.error(`Found ${sessions.length} session file(s)`);
  }

  // Process each session
  for (const session of sessions) {
    try {
      // Read and parse using the adapter that discovered this file
      const content = await Bun.file(session.path).text();
      const transcripts = session.adapter.parse(content, session.path);

      // Get all existing outputs for this source
      const existingPaths = existingOutputs.get(session.path) || [];

      // Check if sync needed (any stale, count mismatch, or force)
      if (
        !(await needsSync(
          existingPaths,
          transcripts.length,
          session.mtime,
          force,
        ))
      ) {
        if (!quiet) {
          console.error(`Skip (up to date): ${session.relativePath}`);
        }
        result.skipped++;
        continue;
      }

      // Delete existing outputs before regenerating
      for (const oldPath of existingPaths) {
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

      // Generate fresh outputs for all transcripts
      for (let i = 0; i < transcripts.length; i++) {
        const transcript = transcripts[i];
        const suffix = transcripts.length > 1 ? `_${i + 1}` : undefined;

        // Generate descriptive name, preserving directory structure
        const baseName = await generateOutputName(
          transcript,
          session.path,
          naming || {},
        );
        const finalName = suffix ? `${baseName}${suffix}` : baseName;
        const relativeDir = dirname(session.relativePath);
        const outputPath = join(output, relativeDir, `${finalName}.md`);

        // Ensure output directory exists
        await mkdir(dirname(outputPath), { recursive: true });

        // Render with provenance front matter and write
        const markdown = renderTranscript(transcript, {
          sourcePath: session.path,
        });
        await Bun.write(outputPath, markdown);

        if (!quiet) {
          console.error(`Synced: ${outputPath}`);
        }
      }

      result.synced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${session.relativePath}: ${message}`);
      result.errors++;
    }
  }

  // Summary
  if (!quiet) {
    console.error(
      `\nSync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors`,
    );
  }

  return result;
}
