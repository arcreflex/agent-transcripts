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
  types.ts        # Core types (Transcript, Message, Adapter)
  adapters/       # Source format adapters (currently: claude-code)
  utils/          # Helpers (summary extraction)
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

## Architecture

Two-stage pipeline: Parse (source → JSON) → Render (JSON → markdown).

- Adapters handle source formats (see `src/adapters/index.ts` for registry)
- Auto-detection: paths containing `.claude/` → claude-code adapter
- Branching conversations preserved via `parentMessageRef` on messages

## Key Types

- `Transcript`: source info, warnings, messages array
- `Message`: union of UserMessage | AssistantMessage | SystemMessage | ToolCallGroup | ErrorMessage
- `Adapter`: `{ name: string, parse(content, sourcePath): Transcript[] }`

## Adding an Adapter

1. Create `src/adapters/<name>.ts` implementing `Adapter`
2. Register in `src/adapters/index.ts` (adapters map + detection rules)
3. Add test fixtures in `test/fixtures/<name>/`

## Tests

Snapshot-based: `*.input.jsonl` → parse → render → compare against `*.output.md`

To update snapshots: manually edit the expected `.output.md` files.
