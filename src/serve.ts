/**
 * Serve command: dynamic HTTP server for transcripts.
 *
 * Serves transcripts directly from source files, using the cache
 * for rendered HTML and titles. No output directory needed.
 */

import { getAdapters } from "./adapters/index.ts";
import type { Adapter, DiscoveredSession, Transcript } from "./types.ts";
import { renderTranscriptHtml } from "./render-html.ts";
import { renderIndexFromSessions, type SessionEntry } from "./render-index.ts";
import { generateOutputName } from "./utils/naming.ts";
import { extractFirstUserMessage } from "./utils/provenance.ts";
import {
  computeContentHash,
  loadCache,
  saveCache,
  getCachedSegments,
  type CacheEntry,
} from "./cache.ts";

export interface ServeOptions {
  source: string;
  port?: number;
  quiet?: boolean;
  noCache?: boolean;
}

interface SessionInfo {
  source: DiscoveredSession;
  adapter: Adapter;
  baseName: string; // e.g., "2024-01-15-1423-sessionid"
  segmentIndex: number; // 0-indexed segment within multi-transcript source
}

/**
 * Discover sessions and build URL mapping.
 * Returns map of baseName → session info.
 */
async function discoverSessions(
  sourceDir: string,
): Promise<Map<string, SessionInfo[]>> {
  const sessions = new Map<string, SessionInfo[]>();

  for (const adapter of getAdapters()) {
    const discovered = await adapter.discover(sourceDir);
    for (const source of discovered) {
      // Parse to get transcript info for naming
      // We need to parse once to determine the output name
      const content = await Bun.file(source.path).text();
      const transcripts = adapter.parse(content, source.path);

      for (let i = 0; i < transcripts.length; i++) {
        const transcript = transcripts[i];
        const baseName = generateOutputName(transcript, source.path);
        const suffix = transcripts.length > 1 ? `_${i + 1}` : "";
        const fullName = `${baseName}${suffix}`;

        const info: SessionInfo = {
          source,
          adapter,
          baseName: fullName,
          segmentIndex: i,
        };

        // Store by baseName for lookup
        const existing = sessions.get(fullName) || [];
        existing.push(info);
        sessions.set(fullName, existing);
      }
    }
  }

  return sessions;
}

/**
 * Get or render HTML for a session.
 * Uses cache if available and content unchanged (unless noCache is true).
 */
async function getSessionHtml(
  session: SessionInfo,
  segmentIndex: number,
  noCache = false,
): Promise<{
  html: string;
  transcript: Transcript;
  contentHash: string;
} | null> {
  const content = await Bun.file(session.source.path).text();
  const contentHash = computeContentHash(content);

  // Parse first to validate segment index
  const transcripts = session.adapter.parse(content, session.source.path);
  if (segmentIndex < 0 || segmentIndex >= transcripts.length) {
    return null;
  }
  const transcript = transcripts[segmentIndex];

  // Check cache (unless bypassing for dev)
  const cached = await loadCache(session.source.path);
  if (!noCache) {
    const cachedSegments = getCachedSegments(cached, contentHash, "html");
    const cachedHtml = cachedSegments?.[segmentIndex]?.html;
    if (cachedHtml) {
      return { html: cachedHtml, transcript, contentHash };
    }
  }

  // Still use cached title if available
  const title =
    cached?.contentHash === contentHash
      ? cached.segments[segmentIndex]?.title
      : undefined;

  const html = await renderTranscriptHtml(transcript, { title });

  // Update cache (even in noCache mode, for titles)
  if (!noCache) {
    // Deep copy segments to avoid mutating cached objects
    const newCache: CacheEntry = {
      contentHash,
      segments:
        cached?.contentHash === contentHash
          ? cached.segments.map((s) => ({ ...s }))
          : [],
    };
    while (newCache.segments.length <= segmentIndex) {
      newCache.segments.push({});
    }
    newCache.segments[segmentIndex].html = html;
    if (title) {
      newCache.segments[segmentIndex].title = title;
    }
    await saveCache(session.source.path, newCache);
  }

  return { html, transcript, contentHash };
}

/**
 * Build session entries for index page.
 */
async function buildIndexEntries(
  sessions: Map<string, SessionInfo[]>,
): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];

  for (const [baseName, infos] of sessions) {
    for (const info of infos) {
      const { segmentIndex } = info;

      try {
        const content = await Bun.file(info.source.path).text();
        const contentHash = computeContentHash(content);
        const transcripts = info.adapter.parse(content, info.source.path);
        const transcript = transcripts[segmentIndex];

        if (!transcript) continue;

        // Get cached title
        const cached = await loadCache(info.source.path);
        const title =
          cached?.contentHash === contentHash
            ? cached.segments[segmentIndex]?.title
            : undefined;

        const firstUserMessage = extractFirstUserMessage(transcript);
        const { messageCount, startTime, endTime, cwd } = transcript.metadata;

        entries.push({
          filename: `${baseName}.html`,
          title:
            title ||
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
      } catch {
        // Skip sessions that fail to parse
      }
    }
  }

  return entries;
}

/**
 * Start the HTTP server.
 */
export async function serve(options: ServeOptions): Promise<void> {
  const { source, port = 3000, quiet = false, noCache = false } = options;

  if (!quiet) {
    console.error(`Discovering sessions in ${source}...`);
  }

  // Discover sessions on startup
  const sessions = await discoverSessions(source);

  if (!quiet) {
    console.error(`Found ${sessions.size} session(s)`);
    console.error(`Starting server at http://localhost:${port}`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Log request
      if (!quiet) {
        console.error(`${req.method} ${path}`);
      }

      // Index page
      if (path === "/" || path === "/index.html") {
        const entries = await buildIndexEntries(sessions);
        const html = renderIndexFromSessions(entries);
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Session page
      if (path.endsWith(".html")) {
        const baseName = path.slice(1, -5); // Remove leading "/" and ".html"

        // First try exact match
        const exactInfos = sessions.get(baseName);
        if (exactInfos && exactInfos.length > 0) {
          try {
            const info = exactInfos[0];
            const result = await getSessionHtml(
              info,
              info.segmentIndex,
              noCache,
            );
            if (!result) {
              return new Response("Not Found", { status: 404 });
            }
            return new Response(result.html, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return new Response(`Error: ${message}`, { status: 500 });
          }
        }

        // Fallback: parse segment suffix (e.g., "name_2" → base "name" + segment 1)
        // Handles case where URL has suffix but session was stored without it
        const segmentMatch = baseName.match(/^(.+)_(\d+)$/);
        if (segmentMatch) {
          const lookupName = segmentMatch[1];
          const segmentIndex = parseInt(segmentMatch[2], 10) - 1;
          const infos = sessions.get(lookupName);
          if (infos && infos.length > 0 && segmentIndex >= 0) {
            try {
              const result = await getSessionHtml(
                infos[0],
                segmentIndex,
                noCache,
              );
              if (!result) {
                return new Response("Not Found", { status: 404 });
              }
              const { html } = result;
              return new Response(html, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return new Response(`Error: ${message}`, { status: 500 });
            }
          }
        }

        return new Response("Not Found", { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  // Keep server running
  if (!quiet) {
    console.error(`\nPress Ctrl+C to stop`);
  }

  // Handle shutdown gracefully
  process.on("SIGINT", () => {
    if (!quiet) {
      console.error("\nShutting down...");
    }
    server.stop();
    process.exit(0);
  });
}
