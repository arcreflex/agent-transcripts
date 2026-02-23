/**
 * Serve command: HTTP server for transcripts from the archive.
 *
 * Reads archive entries, renders on demand in multiple formats:
 * - .html — rich HTML rendering (LRU cached, shiki highlighting)
 * - .md   — markdown (lightweight, agent-friendly)
 * - .json — raw transcript data
 */

import type { ArchiveEntryHeader, TranscriptSummary } from "./archive.ts";
import { listEntryHeaders, loadEntry, DEFAULT_ARCHIVE_DIR } from "./archive.ts";
import type { Transcript } from "./types.ts";
import { renderTranscriptHtml } from "./render-html.ts";
import { renderTranscript } from "./render.ts";
import { renderIndexFromSessions, type SessionEntry } from "./render-index.ts";
import { formatDateTimePrefix } from "./utils/naming.ts";
import { truncate } from "./utils/text.ts";

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

type Format = "html" | "md" | "json";

const CONTENT_TYPES: Record<Format, string> = {
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
};

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

function sessionTitle(info: SessionInfo): string {
  return (
    info.title || truncate(info.segment.firstUserMessage, 80) || info.baseName
  );
}

function buildIndexEntries(sessions: Map<string, SessionInfo>): SessionEntry[] {
  const entries: SessionEntry[] = [];

  for (const [baseName, info] of sessions) {
    const { segment } = info;
    if (segment.metadata.messageCount === 0) continue;

    const { messageCount, startTime, endTime, cwd } = segment.metadata;

    entries.push({
      filename: `${baseName}.html`,
      title: sessionTitle(info),
      firstUserMessage: segment.firstUserMessage,
      date: startTime,
      endDate: endTime,
      messageCount,
      cwd,
    });
  }

  return entries;
}

// ============================================================================
// Format-specific renderers
// ============================================================================

function renderTranscriptMd(
  transcript: Transcript,
  baseName: string,
  title: string,
): string {
  const nav = `*→ [html](${baseName}.html) · [json](${baseName}.json)*`;
  const md = renderTranscript(transcript, { title });
  // Insert format links after the title line
  return md.replace(/^(# .+)\n/, `$1\n\n${nav}\n`);
}

function renderTranscriptJson(transcript: Transcript): string {
  return JSON.stringify(transcript, null, 2);
}

function renderIndexMd(sessions: Map<string, SessionInfo>): string {
  const sorted = [...sessions.entries()]
    .filter(([, info]) => info.segment.metadata.messageCount > 0)
    .sort(
      (a, b) =>
        new Date(b[1].segment.metadata.startTime).getTime() -
        new Date(a[1].segment.metadata.startTime).getTime(),
    );

  const lines: string[] = [
    "# Agent Transcripts",
    "",
    `${sorted.length} session${sorted.length !== 1 ? "s" : ""}`,
    "",
    "*→ [html](index.html) · [json](index.json)*",
    "",
  ];

  // Group by cwd
  const groups = new Map<string, [string, SessionInfo][]>();
  for (const entry of sorted) {
    const cwd = entry[1].segment.metadata.cwd || "(unknown)";
    const group = groups.get(cwd) || [];
    group.push(entry);
    groups.set(cwd, group);
  }

  for (const [cwd, entries] of groups) {
    lines.push(`## ${cwd}`, "");
    for (const [baseName, info] of entries) {
      const title = sessionTitle(info);
      const msgs = info.segment.metadata.messageCount;
      const preview = truncate(info.segment.firstUserMessage, 100);
      lines.push(`- [${title}](${baseName}.md) — ${msgs} msgs`);
      if (preview) {
        lines.push(`  > ${preview}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

interface IndexJsonSession {
  title: string;
  links: { html: string; md: string; json: string };
  date: string;
  endDate: string;
  messageCount: number;
  cwd?: string;
  firstUserMessage: string;
}

function renderIndexJson(sessions: Map<string, SessionInfo>): string {
  const sorted = [...sessions.entries()]
    .filter(([, info]) => info.segment.metadata.messageCount > 0)
    .sort(
      (a, b) =>
        new Date(b[1].segment.metadata.startTime).getTime() -
        new Date(a[1].segment.metadata.startTime).getTime(),
    );

  const result: IndexJsonSession[] = sorted.map(([baseName, info]) => ({
    title: sessionTitle(info),
    links: {
      html: `${baseName}.html`,
      md: `${baseName}.md`,
      json: `${baseName}.json`,
    },
    date: info.segment.metadata.startTime,
    endDate: info.segment.metadata.endTime,
    messageCount: info.segment.metadata.messageCount,
    cwd: info.segment.metadata.cwd,
    firstUserMessage: info.segment.firstUserMessage,
  }));

  return JSON.stringify({ sessions: result }, null, 2);
}

// ============================================================================
// Server
// ============================================================================

/** Parse a URL path into baseName + format, or null if unrecognized. */
function parseRoute(
  path: string,
):
  | { type: "index"; format: Format }
  | { type: "session"; baseName: string; format: Format }
  | null {
  if (path === "/") return { type: "index", format: "html" };

  const match = path.match(/^\/(.+)\.(html|md|json)$/);
  if (!match) return null;

  const [, name, ext] = match;
  const format = ext as Format;

  if (name === "index") return { type: "index", format };
  return { type: "session", baseName: name, format };
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

  // Index HTML is static (session map doesn't change), so build once
  const indexHtml = renderIndexFromSessions(buildIndexEntries(sessions));
  const indexMd = renderIndexMd(sessions);
  const indexJson = renderIndexJson(sessions);

  if (!quiet) {
    console.error(`Found ${sessions.size} transcript(s)`);
    console.error(`Starting server at http://localhost:${port}`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const route = parseRoute(url.pathname);

      if (!quiet) {
        console.error(`${req.method} ${url.pathname}`);
      }

      if (!route) {
        return new Response("Not Found", { status: 404 });
      }

      // Index
      if (route.type === "index") {
        const body =
          route.format === "html"
            ? indexHtml
            : route.format === "md"
              ? indexMd
              : indexJson;
        return new Response(body, {
          headers: { "Content-Type": CONTENT_TYPES[route.format] },
        });
      }

      // Session
      const info = sessions.get(route.baseName);
      if (!info) {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const { sessionId, segmentIndex, sourceHash } = info;
        const title = sessionTitle(info);

        // HTML — use LRU cache (shiki rendering is expensive)
        if (route.format === "html") {
          const cached = htmlCache.get(sessionId, segmentIndex, sourceHash);
          if (cached) {
            return new Response(cached, {
              headers: { "Content-Type": CONTENT_TYPES.html },
            });
          }

          const entry = await loadEntry(archiveDir, sessionId);
          const transcript = entry?.transcripts[segmentIndex];
          if (!transcript) return new Response("Not Found", { status: 404 });

          const html = await renderTranscriptHtml(transcript, { title });
          htmlCache.set(sessionId, segmentIndex, sourceHash, html);
          return new Response(html, {
            headers: { "Content-Type": CONTENT_TYPES.html },
          });
        }

        // Markdown and JSON — render on demand (cheap)
        const entry = await loadEntry(archiveDir, sessionId);
        const transcript = entry?.transcripts[segmentIndex];
        if (!transcript) return new Response("Not Found", { status: 404 });

        const body =
          route.format === "md"
            ? renderTranscriptMd(transcript, route.baseName, title)
            : renderTranscriptJson(transcript);

        return new Response(body, {
          headers: { "Content-Type": CONTENT_TYPES[route.format] },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(`Error: ${message}`, { status: 500 });
      }
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
