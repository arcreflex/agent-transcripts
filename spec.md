# agent-transcripts

A CLI tool that transforms AI coding agent session files into human-readable and LLM-readable transcripts.

## Overview

The tool converts session logs from various AI coding agents (starting with Claude Code, with planned support for Codex and others) into a standardized intermediate JSON format, then renders that to markdown. The primary audience is ~70% LLM consumption, ~30% human reading.

## Architecture

### Two-Stage Pipeline

1. **Parse stage**: Source format (e.g., Claude Code JSONL) → Intermediate JSON
2. **Render stage**: Intermediate JSON → Markdown

Both stages are exposed as separate commands, plus a default command that pipelines them.

### Adapter Pattern

Different source formats are handled by adapters. Adapter selection:

- **Auto-detection by file path**: e.g., `.claude/` in path → Claude Code adapter
- **Explicit flag required**: for stdin input or ambiguous paths
- **Override available**: explicit adapter flag always takes precedence

## CLI Interface

Built with `cmd-ts`. Supports both file arguments and stdin piping.

### Commands

```
agent-transcripts [file]              # Full pipeline: source → JSON → markdown
agent-transcripts parse [file]        # Source → intermediate JSON only
agent-transcripts render [file]       # Intermediate JSON → markdown only
```

### Options

- `-o, --output <path>` - Output file path (default: current working directory)
- `--adapter <name>` - Explicitly specify source adapter (required for stdin if not auto-detectable)
- `--head <id>` - Render branch ending at this message ID (default: latest leaf)

### Examples

```bash
# File argument, auto-detect adapter
agent-transcripts ~/.claude/projects/foo/sessions/abc123.jsonl

# Piped input with explicit adapter
cat session.jsonl | agent-transcripts --adapter claude-code

# Just parse to intermediate format
agent-transcripts parse session.jsonl -o transcript.json

# Just render existing intermediate format
agent-transcripts render transcript.json -o transcript.md
```

## Intermediate JSON Format

TypeScript-typed JSON format. Each item includes provenance (source file + UUID) for traceability.

### Structure

Flat sequence of messages, each tagged with role/type. Parallel tool calls are grouped together.

```typescript
interface Transcript {
  source: {
    file: string; // Original source file path
    adapter: string; // Adapter used (e.g., "claude-code")
  };
  metadata: {
    warnings: Warning[]; // Parse warnings (malformed lines, etc.)
  };
  messages: Message[];
}

interface Warning {
  type: string;
  detail: string;
  sourceRef?: string; // UUID or line reference if available
}

type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ToolCallGroup
  | ErrorMessage;

interface BaseMessage {
  sourceRef: string; // UUID from source for provenance
  timestamp: string; // ISO 8601
  parentMessageRef?: string; // Parent message UUID (for tree reconstruction)
}

interface UserMessage extends BaseMessage {
  type: "user";
  content: string;
}

interface AssistantMessage extends BaseMessage {
  type: "assistant";
  content: string;
  thinking?: string; // Full thinking trace if present
}

interface SystemMessage extends BaseMessage {
  type: "system";
  content: string;
}

interface ToolCallGroup extends BaseMessage {
  type: "tool_calls";
  calls: ToolCall[]; // Grouped if parallel, single-element if sequential
}

interface ToolCall {
  name: string;
  summary: string; // One-line summary extracted from result
  error?: string; // If tool call failed, verbatim error
}

interface ErrorMessage extends BaseMessage {
  type: "error";
  content: string; // Verbatim error message
}
```

### Design Decisions

- **Timestamps**: Always preserved
- **Thinking traces**: Included in full
- **Tool call details**: Name + one-line summary only (extract from result, don't generate)
- **Tool call results**: Discarded (recoverable via provenance if needed)
- **Cache markers**: Stripped (API optimization detail, not relevant to transcript)
- **System messages/metadata**: Included inline with type markers
- **Conversation boundaries**: Split into separate output files with indexed suffixes (e.g., `transcript_1.json`, `transcript_2.json`)

### Branching Conversations

When a conversation has multiple branches (same parent with multiple children), the structure is preserved via `parentMessageRef` fields. During rendering:

- **Default**: Render the "primary" branch (path to the latest leaf by timestamp), with references to other branches at branch points
- **`--head <id>`**: Render from root to the specified message ID (for viewing non-primary branches)

Branch references appear as blockquotes showing the message ID and first line of each alternate branch.

## Markdown Output

Optimized for both GitHub rendering and LLM consumption.

### Formatting

- **Thinking blocks**: Collapsible `<details>` sections
- **Tool calls**: Inline, showing name and summary
- **Parallel tool calls**: Visually grouped
- **System messages**: Clearly marked inline
- **Errors**: Preserved verbatim with clear markers

### Example Output

```markdown
# Transcript

**Source**: `~/.claude/projects/foo/sessions/abc123.jsonl`
**Adapter**: claude-code

---

## User

Can you help me fix the type error in auth.ts?

## Assistant

<details>
<summary>Thinking...</summary>

Let me look at the auth.ts file to understand the type error...

</details>

I'll take a look at that file.

**Tools**: Read `/src/auth.ts`

The issue is on line 42 where...

---

## User

...
```

## Error Handling

- **Malformed input**: Best effort processing
  - Warn about skipped/malformed lines
  - Record warnings in output metadata
  - Continue processing valid content
- **Truncated files**: Process what's available, warn in output
- **Missing fields**: Use sensible defaults, warn if significant

## Adapters

### Claude Code (initial)

Parses `.jsonl` session files from `~/.claude/projects/*/sessions/`.

Detection: File path contains `.claude/`

Key mappings:

- Extract message UUIDs for provenance
- Parse `content` arrays for text, thinking, tool_use, tool_result blocks
- Extract one-line summaries from tool results (look for existing summary fields or first meaningful line)
- Handle conversation boundaries (e.g., `/clear` commands)

### Future: Codex

TBD - investigate format when adding support.

## Non-Goals

- **Filtering**: No time-range or content filtering (full transcript only)
- **Annotations**: Out of scope (separate tooling concern)
- **Schema versioning**: Keep simple; handle breaking changes ad-hoc
- **Full tool results**: Not preserved (use provenance to recover from source if needed)

## Implementation Notes

- Runtime: Bun (script, not compiled)
- CLI framework: cmd-ts
- Files small enough (without tool results) to handle in-memory; no streaming needed
- Provenance uses source UUIDs (stable across file edits)
