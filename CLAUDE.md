# agent-transcripts

@README.md

## Architectural Notes

- **Source paths are stable**: Session source paths (e.g., `~/.claude/projects/.../sessions/`) are standardized by the tools that create them. Archive entries store the absolute source path for traceability.
- **Archive is the central store**: All derived data (titles, etc.) lives on archive entries. Rendered HTML is in-memory only (LRU in serve). No persistent cache layer.
- **Serve is snapshot-based**: `serve` loads the archive once at startup. It does not live-reload when `watch` archives new sessions. This is a known simplification — revisit if live-updating becomes important.

## Verification

Before committing:
1. `bun run check` (typecheck + prettier)
2. `bun run test` (snapshot tests)
3. Check for documentation drift in README.md
