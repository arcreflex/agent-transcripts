/**
 * Serve command: HTTP server for transcripts from the archive.
 *
 * Reads archive entries, renders HTML on demand with in-memory LRU cache.
 */

import type { ArchiveEntry } from "./archive.ts";
import { listEntries, DEFAULT_ARCHIVE_DIR } from "./archive.ts";
import { renderTranscriptHtml } from "./render-html.ts";
import { renderIndexFromSessions, type SessionEntry } from "./render-index.ts";
import { generateOutputName } from "./utils/naming.ts";

export interface ServeOptions {
  archiveDir?: string;
  port?: number;
  quiet?: boolean;
}

interface SessionInfo {
  entry: ArchiveEntry;
  segmentIndex: number;
  baseName: string;
}

/** Simple LRU cache for rendered HTML. */
class HtmlCache {
  private map = new Map<string, string>();
  constructor(private maxSize: number) {}

  private key(sessionId: string, segmentIndex: number, sourceHash: string) {
    return `${sessionId}:${segmentIndex}:${sourceHash}`;
  }

  get(
    sessionId: string,
    segmentIndex: number,
    sourceHash: string,
  ): string | undefined {
    const k = this.key(sessionId, segmentIndex, sourceHash);
    const val = this.map.get(k);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.map.delete(k);
      this.map.set(k, val);
    }
    return val;
  }

  set(
    sessionId: string,
    segmentIndex: number,
    sourceHash: string,
    html: string,
  ) {
    const k = this.key(sessionId, segmentIndex, sourceHash);
    this.map.delete(k);
    this.map.set(k, html);
    if (this.map.size > this.maxSize) {
      // Evict oldest
      const oldest = this.map.keys().next().value!;
      this.map.delete(oldest);
    }
  }
}

function extractFirstUserMessage(entry: ArchiveEntry, segIdx: number): string {
  const transcript = entry.transcripts[segIdx];
  if (!transcript) return "";
  for (const msg of transcript.messages) {
    if (msg.type === "user") return msg.content;
  }
  return "";
}

/**
 * Build session map from archive entries.
 * Each transcript segment gets its own URL based on generateOutputName.
 */
function buildSessionMap(entries: ArchiveEntry[]): Map<string, SessionInfo> {
  const sessions = new Map<string, SessionInfo>();

  for (const entry of entries) {
    for (let i = 0; i < entry.transcripts.length; i++) {
      const transcript = entry.transcripts[i];
      const baseName = generateOutputName(transcript, entry.sourcePath);
      const suffix = entry.transcripts.length > 1 ? `_${i + 1}` : "";
      const fullName = `${baseName}${suffix}`;

      sessions.set(fullName, { entry, segmentIndex: i, baseName: fullName });
    }
  }

  return sessions;
}

function buildIndexEntries(sessions: Map<string, SessionInfo>): SessionEntry[] {
  const entries: SessionEntry[] = [];

  for (const [baseName, info] of sessions) {
    const { entry, segmentIndex } = info;
    const transcript = entry.transcripts[segmentIndex];
    if (!transcript || transcript.metadata.messageCount === 0) continue;

    const firstUserMessage = extractFirstUserMessage(entry, segmentIndex);
    const { messageCount, startTime, endTime, cwd } = transcript.metadata;

    entries.push({
      filename: `${baseName}.html`,
      title:
        entry.title ||
        (firstUserMessage.length > 80
          ? firstUserMessage.slice(0, 80) + "..."
          : firstUserMessage) ||
        baseName,
      firstUserMessage,
      date: startTime,
      endDate: endTime,
      messageCount,
      cwd,
    });
  }

  return entries;
}

export async function serve(options: ServeOptions): Promise<void> {
  const {
    archiveDir = DEFAULT_ARCHIVE_DIR,
    port = 3000,
    quiet = false,
  } = options;

  if (!quiet) {
    console.error(`Loading archive from ${archiveDir}...`);
  }

  const archiveEntries = await listEntries(archiveDir);
  const sessions = buildSessionMap(archiveEntries);
  const htmlCache = new HtmlCache(200);

  if (!quiet) {
    console.error(`Found ${sessions.size} transcript(s)`);
    console.error(`Starting server at http://localhost:${port}`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (!quiet) {
        console.error(`${req.method} ${path}`);
      }

      // Index page
      if (path === "/" || path === "/index.html") {
        const entries = buildIndexEntries(sessions);
        const html = renderIndexFromSessions(entries);
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Session page
      if (path.endsWith(".html")) {
        const baseName = path.slice(1, -5);
        const info = sessions.get(baseName);

        if (info) {
          try {
            const { entry, segmentIndex } = info;
            const transcript = entry.transcripts[segmentIndex];
            if (!transcript) {
              return new Response("Not Found", { status: 404 });
            }

            // Check LRU cache
            const cached = htmlCache.get(
              entry.sessionId,
              segmentIndex,
              entry.sourceHash,
            );
            if (cached) {
              return new Response(cached, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }

            const html = await renderTranscriptHtml(transcript, {
              title: entry.title,
            });
            htmlCache.set(
              entry.sessionId,
              segmentIndex,
              entry.sourceHash,
              html,
            );
            return new Response(html, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return new Response(`Error: ${message}`, { status: 500 });
          }
        }

        return new Response("Not Found", { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  if (!quiet) {
    console.error(`\nPress Ctrl+C to stop`);
  }

  process.on("SIGINT", () => {
    if (!quiet) {
      console.error("\nShutting down...");
    }
    server.stop();
    process.exit(0);
  });
}
