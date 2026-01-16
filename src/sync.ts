/**
 * Sync command: batch export sessions to markdown transcripts.
 *
 * Discovers session files in source directory, parses them,
 * and writes rendered markdown to output directory.
 * Output structure mirrors source structure with extension changed.
 */

import { Glob } from "bun";
import { dirname, join, relative } from "path";
import { mkdir, stat } from "fs/promises";
import { getAdapters } from "./adapters/index.ts";
import type { Adapter } from "./types.ts";
import { renderTranscript } from "./render.ts";

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

interface SessionFile {
  path: string;
  relativePath: string;
  mtime: number;
  adapter: Adapter;
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
 * Compute output path for a session file.
 * Mirrors input structure, changing extension to .md.
 */
function computeOutputPath(
  relativePath: string,
  outputDir: string,
  suffix?: string,
): string {
  // Replace extension with .md
  const mdPath = relativePath.replace(/\.[^.]+$/, ".md");
  // Add suffix if provided (for multiple transcripts from same file)
  const finalPath = suffix ? mdPath.replace(/\.md$/, `${suffix}.md`) : mdPath;
  return join(outputDir, finalPath);
}

/**
 * Check if output file needs to be re-rendered based on mtime.
 */
async function needsSync(
  outputPath: string,
  sourceMtime: number,
  force: boolean,
): Promise<boolean> {
  if (force) return true;

  try {
    const outputStat = await stat(outputPath);
    return outputStat.mtime.getTime() < sourceMtime;
  } catch {
    // Output doesn't exist, needs sync
    return true;
  }
}

/**
 * Sync session files from source to output directory.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { source, output, force = false, quiet = false } = options;

  const result: SyncResult = { synced: 0, skipped: 0, errors: 0 };

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

      // Process each transcript (usually just one per file)
      for (let i = 0; i < transcripts.length; i++) {
        const transcript = transcripts[i];
        const suffix = transcripts.length > 1 ? `_${i + 1}` : undefined;
        const outputPath = computeOutputPath(
          session.relativePath,
          output,
          suffix,
        );

        // Check if sync needed
        if (!(await needsSync(outputPath, session.mtime, force))) {
          if (!quiet) {
            console.error(`Skip (up to date): ${outputPath}`);
          }
          result.skipped++;
          continue;
        }

        // Ensure output directory exists
        await mkdir(dirname(outputPath), { recursive: true });

        // Render and write
        const markdown = renderTranscript(transcript);
        await Bun.write(outputPath, markdown);

        if (!quiet) {
          console.error(`Synced: ${outputPath}`);
        }
        result.synced++;
      }
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
