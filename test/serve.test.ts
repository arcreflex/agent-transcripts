import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { archiveSession } from "../src/archive.ts";
import { claudeCodeAdapter } from "../src/adapters/claude-code.ts";
import { serve } from "../src/serve.ts";

const fixturesDir = join(import.meta.dir, "fixtures/claude");
const fixture = join(fixturesDir, "basic-conversation.input.jsonl");

let archiveDir: string;
let baseUrl: string;
let stopServer: () => void;

beforeAll(async () => {
  archiveDir = await mkdtemp(join(tmpdir(), "serve-test-"));

  // Archive a fixture so the server has something to serve
  await archiveSession(
    archiveDir,
    {
      path: fixture,
      relativePath: "basic-conversation.input.jsonl",
      mtime: Date.now(),
      summary: "Test conversation",
    },
    claudeCodeAdapter,
  );

  // Start the server on an ephemeral port.
  // serve() doesn't return the server directly, so we call the internals.
  // Instead, we'll use a random high port and just call serve().
  const port = 49152 + Math.floor(Math.random() * 10000);
  baseUrl = `http://localhost:${port}`;

  // serve() installs a SIGINT handler and never resolves. We just need
  // the Bun.serve to be running, so we call it and keep a reference.
  const servePromise = serve({ archiveDir, port, quiet: true });
  stopServer = () => {
    // The server will be cleaned up when the process exits.
    // For test isolation, we rely on Bun.serve stopping when the test ends.
  };

  // Give the server a moment to start
  await Bun.sleep(100);
});

afterAll(async () => {
  await rm(archiveDir, { recursive: true, force: true });
});

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe("serve", () => {
  // ========================================================================
  // Index routes
  // ========================================================================

  describe("index", () => {
    it("GET / returns HTML index", async () => {
      const res = await get("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("Agent Transcripts");
      expect(body).toContain("<!DOCTYPE html>");
    });

    it("GET /index.html returns HTML index", async () => {
      const res = await get("/index.html");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("GET /index.md returns markdown index", async () => {
      const res = await get("/index.md");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const body = await res.text();
      expect(body).toContain("# Agent Transcripts");
      expect(body).toContain(".md)");
    });

    it("GET /index.json returns JSON index", async () => {
      const res = await get("/index.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body.sessions).toBeArray();
      expect(body.sessions.length).toBeGreaterThan(0);
      const session = body.sessions[0];
      expect(session.links.html).toEndWith(".html");
      expect(session.links.md).toEndWith(".md");
      expect(session.links.json).toEndWith(".json");
    });
  });

  // ========================================================================
  // Session routes
  // ========================================================================

  describe("session", () => {
    // Discover the baseName from the JSON index
    let baseName: string;

    beforeAll(async () => {
      const res = await get("/index.json");
      const body = await res.json();
      // Extract baseName from an html link like "2024-01-01-0000-sessionId.html"
      baseName = body.sessions[0].links.html.replace(/\.html$/, "");
    });

    it("GET /{baseName}.html returns HTML transcript", async () => {
      const res = await get(`/${baseName}.html`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
      expect(body).toContain("Test conversation");
    });

    it("GET /{baseName}.md returns markdown transcript", async () => {
      const res = await get(`/${baseName}.md`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      const body = await res.text();
      expect(body).toContain("# Test conversation");
      expect(body).toContain(`${baseName}.html`);
      expect(body).toContain(`${baseName}.json`);
      expect(body).toContain("## User");
      expect(body).toContain("## Assistant");
    });

    it("GET /{baseName}.json returns JSON transcript", async () => {
      const res = await get(`/${baseName}.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body.source).toBeDefined();
      expect(body.messages).toBeArray();
      expect(body.messages.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // 404s
  // ========================================================================

  describe("not found", () => {
    it("returns 404 for unknown session", async () => {
      const res = await get("/nonexistent.html");
      expect(res.status).toBe(404);
    });

    it("returns 404 for unknown extension", async () => {
      const res = await get("/index.xml");
      expect(res.status).toBe(404);
    });

    it("returns 404 for bare path with no extension", async () => {
      const res = await get("/something");
      expect(res.status).toBe(404);
    });
  });
});
