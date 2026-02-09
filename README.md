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
  convert.ts      # Direct pipeline (parse → render to stdout or directory)
  archive.ts      # Persistent archive store (~/.local/share/agent-transcripts/archive/)
  watch.ts        # Continuous archive updates via fs.watch + polling
  serve.ts        # HTTP server serving from archive with in-memory LRU
  title.ts        # LLM title generation (writes to archive entries)
  types.ts        # Core types (Transcript, Message, Adapter)
  adapters/       # Source format adapters (currently: claude-code)
  utils/
    naming.ts     # Deterministic output file naming
    summary.ts    # Tool call summary extraction
    openrouter.ts # OpenRouter API client for title generation
    html.ts       # HTML escaping utility
    tree.ts       # Tree navigation and walkTranscriptTree generator
    text.ts       # Shared text utilities (truncate)
    theme.ts      # Shared CSS theme constants
test/
  fixtures/       # Snapshot test inputs/outputs
  snapshots.test.ts
  adapters.test.ts
  archive.test.ts
  watch.test.ts
  tree.test.ts
  naming.test.ts
  summary.test.ts
```

## Commands

```bash
bun run check        # typecheck + prettier
bun run test         # snapshot tests + archive tests
bun run format       # auto-format
```

## CLI Usage

```bash
# Subcommands (convert is default if omitted)
agent-transcripts convert <file>              # Parse and render to stdout
agent-transcripts convert <file> -o <dir>     # Parse and render to directory

# Archive management
agent-transcripts archive                     # Auto-discover from adapter defaults (~/.claude)
agent-transcripts archive /path --adapter claude-code  # Explicit source + adapter
agent-transcripts archive --archive-dir ~/my-archive   # Custom archive location

# Serving
agent-transcripts serve                       # Serve from default archive
agent-transcripts serve --archive-dir <dir>   # Serve from custom archive
agent-transcripts serve -p 8080               # Custom port

# Watching
agent-transcripts watch                       # Auto-discover from adapter defaults
agent-transcripts watch /path --adapter claude-code    # Explicit source + adapter
agent-transcripts watch --poll-interval 60000

# Title generation
agent-transcripts title                       # Generate titles for archive entries
agent-transcripts title -f                    # Force regenerate all titles

# Use "-" for stdin
cat session.jsonl | agent-transcripts -
```

## Architecture

```
Source (Claude Code sessions)
    ↓ [archive / watch]
Archive (~/.local/share/agent-transcripts/archive/{sessionId}.json)
    ↓ [serve]
HTML (rendered on demand, in-memory LRU)
```

`convert` is a standalone direct pipeline (no archive dependency).

`serve` loads the archive once at startup — it won't pick up new sessions archived by a concurrent `watch` without a restart. Live-reloading could be added later (periodic re-listing or file-watch trigger) if needed.

- Adapters handle source formats (see `src/adapters/index.ts` for registry)
- Auto-detection: paths containing `.claude/` → claude-code adapter
- Branching conversations preserved via `parentMessageRef` on messages
- Deterministic naming: `{datetime}-{sessionId}.md`

### Archive

The archive is the central data store at `$XDG_DATA_HOME/agent-transcripts/archive/` (defaults to `~/.local/share/agent-transcripts/archive/`):

```
$XDG_DATA_HOME/agent-transcripts/archive/
  {sessionId}.json  →  ArchiveEntry
```

```typescript
interface ArchiveEntry {
  sessionId: string;
  sourcePath: string; // absolute source path
  sourceHash: string; // content hash (invalidation key)
  adapterName: string;
  adapterVersion: string; // e.g. "claude-code:1"
  schemaVersion: number;
  archivedAt: string; // ISO timestamp
  title?: string; // harness-provided or LLM-generated
  transcripts: Transcript[];
}
```

Freshness is determined by `sourceHash + adapterVersion + schemaVersion`. When any changes, the entry is re-archived.

## Key Types

- `Transcript`: source info, warnings, messages array
- `Message`: union of UserMessage | AssistantMessage | SystemMessage | ToolCallGroup | ErrorMessage
- `Adapter`: name, version, discover function, parse function

### Titles

Transcripts get titles from (in priority order):

1. Harness-provided summary (e.g., Claude Code's sessions-index.json `summary` field)
2. Existing title from previous archive entry
3. LLM-generated title via OpenRouter (requires `OPENROUTER_API_KEY`)

## Adding an Adapter

1. Create `src/adapters/<name>.ts` implementing `Adapter`
2. Register in `src/adapters/index.ts` (adapters map + detection rules)
3. Add test fixtures in `test/fixtures/<name>/`

## Development Scripts

- `scripts/infer-cc-types.prose`: open-prose program to infer types from real CC session data

## Tests

Snapshot-based: `*.input.jsonl` → parse → render → compare against `*.output.md`

Archive tests: real fixture files + temp dirs to verify archiving, freshness, listing.

To update snapshots: manually edit the expected `.output.md` files.
