/**
 * Cache module for agent-transcripts.
 *
 * Stores derived content (rendered outputs, titles) keyed by source path,
 * invalidated by content hash. Cache lives at ~/.cache/agent-transcripts/.
 */

import { join } from "path";
import { homedir } from "os";
import { mkdir, rename, unlink } from "fs/promises";

const CACHE_DIR = join(homedir(), ".cache", "agent-transcripts");

export interface SegmentCache {
  title?: string;
  html?: string;
  md?: string;
}

export interface CacheEntry {
  contentHash: string;
  segments: SegmentCache[];
}

/**
 * Compute a hash of file content for cache invalidation.
 */
export function computeContentHash(content: string): string {
  return Bun.hash(content).toString(16);
}

/**
 * Get the cache file path for a source file.
 * Uses hash of source path to avoid filesystem issues with special chars.
 */
function getCachePath(sourcePath: string): string {
  const pathHash = Bun.hash(sourcePath).toString(16);
  return join(CACHE_DIR, `${pathHash}.json`);
}

/**
 * Ensure cache directory exists.
 */
async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o755 });
}

/**
 * Load cache entry for a source file.
 * Returns undefined if no cache exists or cache is corrupt.
 */
export async function loadCache(
  sourcePath: string,
): Promise<CacheEntry | undefined> {
  const cachePath = getCachePath(sourcePath);
  try {
    const content = await Bun.file(cachePath).text();
    return JSON.parse(content) as CacheEntry;
  } catch {
    return undefined;
  }
}

/**
 * Save cache entry for a source file.
 * Uses atomic write (temp file + rename) to prevent corruption.
 */
export async function saveCache(
  sourcePath: string,
  entry: CacheEntry,
): Promise<void> {
  await ensureCacheDir();

  const cachePath = getCachePath(sourcePath);
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;

  const content = JSON.stringify(entry, null, 2) + "\n";
  await Bun.write(tmpPath, content);

  try {
    await rename(tmpPath, cachePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Check if cache is valid for the given content hash and format.
 * Returns the cached segments if valid, undefined otherwise.
 */
export function getCachedSegments(
  cached: CacheEntry | undefined,
  contentHash: string,
  format: "html" | "md",
): SegmentCache[] | undefined {
  if (!cached || cached.contentHash !== contentHash) {
    return undefined;
  }
  // Check that all segments have the requested format
  if (cached.segments.length === 0) {
    return undefined;
  }
  for (const seg of cached.segments) {
    if (!seg[format]) {
      return undefined;
    }
  }
  return cached.segments;
}

/**
 * Get cached title for a specific segment.
 * Returns undefined if cache is invalid or title not present.
 */
export function getCachedTitle(
  cached: CacheEntry | undefined,
  contentHash: string,
  segmentIndex: number,
): string | undefined {
  if (!cached || cached.contentHash !== contentHash) {
    return undefined;
  }
  return cached.segments[segmentIndex]?.title;
}
