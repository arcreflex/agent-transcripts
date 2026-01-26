# agent-transcripts

CLI tool that transforms AI coding agent session files into readable transcripts.

## Stack

- Runtime: Bun
- CLI: cmd-ts
- TypeScript with strict mode

## Structure

```
src/
  cli.ts          # CLI entry point, subcommand routing
  parse.ts        # Source → intermediate format
  render.ts       # Intermediate format → markdown
  render-html.ts  # HTML transcript rendering
  render-index.ts # Index page rendering
  convert.ts      # Full pipeline with provenance tracking
  sync.ts         # Batch sync sessions → markdown
  serve.ts        # HTTP server for dynamic transcript serving
  cache.ts        # Content-hash-based caching (~/.cache/agent-transcripts/)
  title.ts        # LLM title generation
  types.ts        # Core types (Transcript, Message, Adapter)
  adapters/       # Source format adapters (currently: claude-code)
  utils/
    naming.ts     # Deterministic output file naming
    provenance.ts # Source tracking via transcripts.json + YAML front matter
    summary.ts    # Tool call summary extraction
    openrouter.ts # OpenRouter API client for title generation
    html.ts       # HTML escaping utility
    tree.ts       # Tree navigation utilities
test/
  fixtures/       # Snapshot test inputs/outputs
  snapshots.test.ts
```

## Commands

```bash
bun run check        # typecheck + prettier
bun run test         # snapshot tests
bun run format       # auto-format
```

## CLI Usage

```bash
# Subcommands (convert is default if omitted)
agent-transcripts convert <file>              # Parse and render to stdout
agent-transcripts convert <file> -o <dir>     # Parse and render to directory
agent-transcripts sync <dir> -o <out>         # Batch sync sessions
agent-transcripts serve <dir>                 # Serve transcripts via HTTP
agent-transcripts serve <dir> -p 8080         # Serve on custom port

# Use "-" for stdin
cat session.jsonl | agent-transcripts -
```

## Architecture

Two-stage pipeline: Parse (source → intermediate) → Render (intermediate → markdown).

- Adapters handle source formats (see `src/adapters/index.ts` for registry)
- Auto-detection: paths containing `.claude/` → claude-code adapter
- Branching conversations preserved via `parentMessageRef` on messages
- Provenance tracking via `transcripts.json` index + YAML front matter
- Deterministic naming: `{datetime}-{sessionId}.md`
- Sync uses sessions-index.json for discovery (claude-code), skipping subagent files
- Sync uses content hash to skip unchanged sources (see Cache section)

### Cache

Derived content (rendered outputs, LLM-generated titles) is cached at `~/.cache/agent-transcripts/`:

```
~/.cache/agent-transcripts/
  {source-path-hash}.json  →  CacheEntry
```

```typescript
interface CacheEntry {
  contentHash: string; // hash of source content (invalidation key)
  segments: Array<{
    title?: string; // LLM-generated title
    html?: string; // rendered HTML
    md?: string; // rendered markdown
  }>;
}
```

Cache is keyed by source path (hashed), invalidated by content hash. When source content changes, all cached data is invalidated and regenerated.

### transcripts.json

The index file is a table of contents for the output directory:

```typescript
interface TranscriptsIndex {
  version: 1;
  entries: {
    [outputFilename: string]: {
      source: string; // absolute path to source
      sessionId: string; // full session ID from filename
      segmentIndex?: number; // for multi-transcript sources (1-indexed)
      syncedAt: string; // ISO timestamp
      firstUserMessage: string; // first user message content
      title?: string; // copied from cache for convenience
      messageCount: number;
      startTime: string; // ISO timestamp
      endTime: string; // ISO timestamp
      cwd?: string; // working directory
    };
  };
}
```

## Key Types

- `Transcript`: source info, warnings, messages array
- `Message`: union of UserMessage | AssistantMessage | SystemMessage | ToolCallGroup | ErrorMessage
- `Adapter`: name, discover function, parse function

## Adding an Adapter

1. Create `src/adapters/<name>.ts` implementing `Adapter`
2. Register in `src/adapters/index.ts` (adapters map + detection rules)
3. Add test fixtures in `test/fixtures/<name>/`

## Tests

Snapshot-based: `*.input.jsonl` → parse → render → compare against `*.output.md`

To update snapshots: manually edit the expected `.output.md` files.
