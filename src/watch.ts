/**
 * Watch module: keep archive in sync with source directories.
 *
 * Uses fs.watch for change detection with periodic full scan as fallback.
 * Multiple watchers can safely target the same archive — writes are atomic
 * (tmp + rename) and archiving is idempotent.
 */

import { watch, type FSWatcher } from "fs";
import type { SourceSpec } from "./types.ts";
import {
  archiveAll,
  DEFAULT_ARCHIVE_DIR,
  type ArchiveResult,
} from "./archive.ts";

export interface WatchOptions {
  archiveDir?: string;
  pollIntervalMs?: number;
  onUpdate?: (result: ArchiveResult) => void;
  onError?: (error: Error) => void;
  quiet?: boolean;
}

export class ArchiveWatcher {
  private sources: SourceSpec[];
  private archiveDir: string;
  private pollIntervalMs: number;
  private onUpdate?: (result: ArchiveResult) => void;
  private onError?: (error: Error) => void;
  private quiet: boolean;
  private watchers: FSWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(sources: SourceSpec[], options: WatchOptions = {}) {
    this.sources = sources;
    this.archiveDir = options.archiveDir ?? DEFAULT_ARCHIVE_DIR;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;
    this.quiet = options.quiet ?? false;
  }

  async start(): Promise<void> {
    // Initial scan
    await this.scan();

    // Set up fs.watch on each unique source dir
    const watchedDirs = new Set<string>();
    for (const spec of this.sources) {
      if (watchedDirs.has(spec.source)) continue;
      watchedDirs.add(spec.source);

      try {
        const watcher = watch(
          spec.source,
          { recursive: true },
          (_event, filename) => {
            if (filename && filename.endsWith(".jsonl")) {
              this.debouncedScan();
            }
          },
        );
        this.watchers.push(watcher);
      } catch (err) {
        if (!this.quiet) {
          console.error(
            `Warning: could not watch ${spec.source}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Periodic fallback scan
    this.pollTimer = setInterval(() => this.scan(), this.pollIntervalMs);
  }

  stop(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private debouncedScan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.scan(), 500);
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    try {
      for (const spec of this.sources) {
        const result = await archiveAll(
          this.archiveDir,
          spec.source,
          [spec.adapter],
          { quiet: this.quiet },
        );
        if (result.updated.length > 0 || result.errors.length > 0) {
          this.onUpdate?.(result);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError?.(error);
    } finally {
      this.scanning = false;
    }
  }
}
