/**
 * Serve command: HTTP server for transcripts from the archive.
 *
 * Reads archive entries, renders HTML on demand with in-memory LRU cache.
 */

import type { ArchiveEntryHeader, TranscriptSummary } from "./archive.ts";
import { listEntryHeaders, loadEntry, DEFAULT_ARCHIVE_DIR } from "./archive.ts";
import { renderTranscriptHtml } from "./render-html.ts";
import { renderIndexFromSessions, type SessionEntry } from "./render-index.ts";
import { formatDateTimePrefix } from "./utils/naming.ts";

export interface ServeOptions {
  archiveDir?: string;
  port?: number;
  quiet?: boolean;
}

interface SessionInfo {
  sessionId: string;
  sourceHash: string;
  title?: string;
  segment: TranscriptSummary;
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

function buildSessionMap(
  headers: ArchiveEntryHeader[],
): Map<string, SessionInfo> {
  const sessions = new Map<string, SessionInfo>();

  for (const header of headers) {
    for (let i = 0; i < header.segments.length; i++) {
      const segment = header.segments[i];
      const dateTime = formatDateTimePrefix(segment.firstMessageTimestamp);
      const baseName = `${dateTime}-${header.sessionId}`;
      const suffix = header.segments.length > 1 ? `_${i + 1}` : "";
      const fullName = `${baseName}${suffix}`;

      sessions.set(fullName, {
        sessionId: header.sessionId,
        sourceHash: header.sourceHash,
        title: header.title,
        segment,
        segmentIndex: i,
        baseName: fullName,
      });
    }
  }

  return sessions;
}

function buildIndexEntries(sessions: Map<string, SessionInfo>): SessionEntry[] {
  const entries: SessionEntry[] = [];

  for (const [baseName, info] of sessions) {
    const { segment, title } = info;
    if (segment.metadata.messageCount === 0) continue;

    const { messageCount, startTime, endTime, cwd } = segment.metadata;

    entries.push({
      filename: `${baseName}.html`,
      title:
        title ||
        (segment.firstUserMessage.length > 80
          ? segment.firstUserMessage.slice(0, 80) + "..."
          : segment.firstUserMessage) ||
        baseName,
      firstUserMessage: segment.firstUserMessage,
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

  const headers = await listEntryHeaders(archiveDir);
  const sessions = buildSessionMap(headers);
  const htmlCache = new HtmlCache(200);

  // Index is static (session map doesn't change), so build once
  const indexHtml = renderIndexFromSessions(buildIndexEntries(sessions));

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
        return new Response(indexHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Session page
      if (path.endsWith(".html")) {
        const baseName = path.slice(1, -5);
        const info = sessions.get(baseName);

        if (info) {
          try {
            const { sessionId, segmentIndex, sourceHash, title } = info;

            const cached = htmlCache.get(sessionId, segmentIndex, sourceHash);
            if (cached) {
              return new Response(cached, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }

            // Load full entry from disk on demand
            const entry = await loadEntry(archiveDir, sessionId);
            const transcript = entry?.transcripts[segmentIndex];
            if (!transcript) {
              return new Response("Not Found", { status: 404 });
            }

            const html = await renderTranscriptHtml(transcript, { title });
            htmlCache.set(sessionId, segmentIndex, sourceHash, html);
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
