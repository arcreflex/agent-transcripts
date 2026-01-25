# agent-transcripts

@README.md

## Architectural Notes

- **Source paths are stable**: Session source paths (e.g., `~/.claude/projects/.../sessions/`) are standardized by the tools that create them. Don't over-engineer for path changes—use source paths as cache keys directly.

## Verification

Before committing:
1. `bun run check` (typecheck + prettier)
2. `bun run test` (snapshot tests)
3. Check for documentation drift in README.md
