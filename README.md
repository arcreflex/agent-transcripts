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
  parse.ts        # Source → intermediate JSON
  render.ts       # Intermediate JSON → markdown
  convert.ts      # Full pipeline with provenance tracking
  sync.ts         # Batch sync sessions → markdown
  types.ts        # Core types (Transcript, Message, Adapter)
  adapters/       # Source format adapters (currently: claude-code)
  utils/
    naming.ts     # Descriptive output file naming
    provenance.ts # Source tracking via YAML front matter
    summary.ts    # Summary extraction
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
agent-transcripts convert <file>    # Full pipeline: parse → render
agent-transcripts parse <file>      # Source → intermediate JSON
agent-transcripts render <file>     # JSON → markdown
agent-transcripts sync <dir> -o <out>  # Batch sync sessions

# Use "-" for stdin
cat session.jsonl | agent-transcripts -

# Environment variables
OPENROUTER_API_KEY=...   # Enables LLM-based descriptive output naming
```

## Architecture

Two-stage pipeline: Parse (source → JSON) → Render (JSON → markdown).

- Adapters handle source formats (see `src/adapters/index.ts` for registry)
- Auto-detection: paths containing `.claude/` → claude-code adapter
- Branching conversations preserved via `parentMessageRef` on messages
- Provenance tracking: rendered markdown includes YAML front matter with source path
- Descriptive naming: output files named by date + summary (LLM-enhanced if API key set)
- Sync uses sessions-index.json for discovery (claude-code), skipping subagent files
- Sync uses mtime to skip unchanged sources

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
