/**
 * Watch module: keep archive in sync with source directories.
 *
 * Uses fs.watch for change detection with periodic full scan as fallback.
 * Lockfile prevents concurrent watchers on the same archive.
 */

import { watch, unlinkSync, type FSWatcher } from "fs";
import { join } from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import { getAdapters } from "./adapters/index.ts";
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

function lockPath(archiveDir: string): string {
  return join(archiveDir, "archive.lock");
}

async function acquireLock(archiveDir: string): Promise<boolean> {
  await mkdir(archiveDir, { recursive: true });
  const lock = lockPath(archiveDir);
  try {
    const existing = await readFile(lock, "utf-8").catch(() => null);
    if (existing) {
      // Check if the PID is still alive
      const pid = parseInt(existing, 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return false; // Process is alive, lock is held
        } catch {
          // Process is dead, stale lock — fall through to acquire
        }
      }
    }
    await writeFile(lock, String(process.pid), { flag: "w" });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(archiveDir: string): void {
  try {
    unlinkSync(lockPath(archiveDir));
  } catch {}
}

export class ArchiveWatcher {
  private sourceDirs: string[];
  private archiveDir: string;
  private pollIntervalMs: number;
  private onUpdate?: (result: ArchiveResult) => void;
  private onError?: (error: Error) => void;
  private quiet: boolean;
  private watchers: FSWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(sourceDirs: string[], options: WatchOptions = {}) {
    this.sourceDirs = sourceDirs;
    this.archiveDir = options.archiveDir ?? DEFAULT_ARCHIVE_DIR;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.onUpdate = options.onUpdate;
    this.onError = options.onError;
    this.quiet = options.quiet ?? false;
  }

  async start(): Promise<void> {
    const locked = await acquireLock(this.archiveDir);
    if (!locked) {
      throw new Error(
        `Another watcher is already running on ${this.archiveDir}`,
      );
    }

    // Initial scan
    await this.scan();

    // Set up fs.watch on each source dir
    for (const dir of this.sourceDirs) {
      try {
        const watcher = watch(dir, { recursive: true }, (_event, filename) => {
          if (filename && filename.endsWith(".jsonl")) {
            this.debouncedScan();
          }
        });
        this.watchers.push(watcher);
      } catch (err) {
        if (!this.quiet) {
          console.error(
            `Warning: could not watch ${dir}: ${err instanceof Error ? err.message : String(err)}`,
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

    releaseLock(this.archiveDir);
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
      const adapters = getAdapters();
      for (const dir of this.sourceDirs) {
        const result = await archiveAll(this.archiveDir, dir, adapters, {
          quiet: this.quiet,
        });
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
