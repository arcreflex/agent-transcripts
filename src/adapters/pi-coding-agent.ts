/**
 * pi-coding-agent JSONL adapter.
 *
 * Parses session files from ~/.pi/sessions/{encoded-cwd}/{timestamp}_{uuid}.jsonl
 *
 * Session format: tree-structured JSONL with id/parentId linking (version 3).
 * See: https://github.com/badlogic/pi-mono — pi-coding-agent session docs.
 */

import { Glob } from "bun";
import { join } from "path";
import { homedir } from "os";
import { stat } from "fs/promises";
import type {
  Adapter,
  DiscoveredSession,
  Transcript,
  Message,
  Warning,
  ToolCall,
} from "../types.ts";
import { extractToolSummary } from "../utils/summary.ts";

// ============================================================================
// Session file types (pi-coding-agent JSONL format, version 3)
// ============================================================================

interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

// Content block types

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

interface PiToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

type ContentBlock = TextContent | ImageContent | ThinkingContent | PiToolCall;

// Message types (embedded in SessionMessageEntry)

interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | PiToolCall)[];
  api: string;
  provider: string;
  model: string;
  stopReason: string;
  errorMessage?: string;
  timestamp: number;
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  timestamp: number;
}

interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  timestamp: number;
}

interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}

interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage;

// Entry types

interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}

interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
}

interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

// Entries we care about for parsing
type SessionEntry =
  | SessionMessageEntry
  | CompactionEntry
  | BranchSummaryEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | SessionInfoEntry;

type FileEntry = SessionHeader | SessionEntry;

// ============================================================================
// Parsing helpers
// ============================================================================

function parseJsonl(content: string): {
  header: SessionHeader | undefined;
  entries: SessionEntry[];
  warnings: Warning[];
} {
  const entries: SessionEntry[] = [];
  const warnings: Warning[] = [];
  let header: SessionHeader | undefined;
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const record = JSON.parse(line) as FileEntry;

      if (record.type === "session") {
        header = record as SessionHeader;
        continue;
      }

      // Skip entry types we don't render (custom, label, custom_message, etc.)
      if (
        record.type === "message" ||
        record.type === "compaction" ||
        record.type === "branch_summary" ||
        record.type === "model_change" ||
        record.type === "thinking_level_change" ||
        record.type === "session_info"
      ) {
        entries.push(record as SessionEntry);
      }
    } catch (e) {
      warnings.push({
        type: "parse_error",
        detail: `Line ${i + 1}: ${e instanceof Error ? e.message : "Invalid JSON"}`,
      });
    }
  }

  return { header, entries, warnings };
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((b) => {
      if (b.type === "text") return [b.text];
      return [];
    })
    .join("\n");
}

function extractThinking(content: ContentBlock[]): string | undefined {
  const parts = content.flatMap((b) =>
    b.type === "thinking" ? [b.thinking] : [],
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function extractPiToolCalls(content: ContentBlock[]): PiToolCall[] {
  return content.filter((b): b is PiToolCall => b.type === "toolCall");
}

// ============================================================================
// Conversation splitting (tree structure via id/parentId)
// ============================================================================

interface SplitResult {
  conversations: SessionEntry[][];
  resolvedParents: Map<string, string | undefined>;
}

function splitConversations(entries: SessionEntry[]): SplitResult {
  if (entries.length === 0) {
    return { conversations: [], resolvedParents: new Map() };
  }

  const byId = new Map<string, SessionEntry>();
  const children = new Map<string, string[]>();
  const resolvedParents = new Map<string, string | undefined>();
  const roots: string[] = [];

  for (const entry of entries) {
    byId.set(entry.id, entry);
  }

  for (const entry of entries) {
    const parentId = entry.parentId;
    if (parentId && byId.has(parentId)) {
      resolvedParents.set(entry.id, parentId);
      const existing = children.get(parentId) || [];
      existing.push(entry.id);
      children.set(parentId, existing);
    } else {
      resolvedParents.set(entry.id, undefined);
      roots.push(entry.id);
    }
  }

  const visited = new Set<string>();
  const conversations: SessionEntry[][] = [];

  for (const root of roots) {
    if (visited.has(root)) continue;

    const conversation: SessionEntry[] = [];
    const queue = [root];

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);

      const entry = byId.get(id);
      if (entry) conversation.push(entry);

      const childIds = children.get(id) || [];
      queue.push(...childIds);
    }

    if (conversation.length > 0) {
      conversations.push(conversation);
    }
  }

  // Sort conversations by first entry timestamp
  conversations.sort((a, b) => {
    const ta = new Date(a[0].timestamp).getTime();
    const tb = new Date(b[0].timestamp).getTime();
    return ta - tb;
  });

  return { conversations, resolvedParents };
}

// ============================================================================
// Transform entries → transcript messages
// ============================================================================

function transformConversation(
  entries: SessionEntry[],
  sourcePath: string,
  warnings: Warning[],
  resolvedParents: Map<string, string | undefined>,
  cwd: string | undefined,
): Transcript {
  const messages: Message[] = [];

  // Collect tool results: toolCallId → { result, isError, toolName }
  const toolResults = new Map<
    string,
    { result: string; isError: boolean; toolName: string }
  >();

  // First pass: collect tool results from toolResult messages
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role === "toolResult") {
      const text = extractText(msg.content);
      toolResults.set(msg.toolCallId, {
        result: text,
        isError: msg.isError,
        toolName: msg.toolName,
      });
    }
  }

  // Track which entry IDs produce messages (for parent resolution through skipped entries)
  const skippedParents = new Map<string, string | undefined>();

  // Identify entries that will be skipped
  for (const entry of entries) {
    let willSkip = false;

    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "toolResult" || msg.role === "bashExecution") {
        willSkip = true;
      } else if (msg.role === "user") {
        const text = extractText(msg.content);
        if (!text.trim()) willSkip = true;
      } else if (msg.role === "assistant") {
        const text = extractText(msg.content);
        const thinking = extractThinking(msg.content as ContentBlock[]);
        const toolCalls = extractPiToolCalls(msg.content as ContentBlock[]);
        if (!text.trim() && !thinking && toolCalls.length === 0) {
          willSkip = true;
        }
      } else if (
        msg.role === "compactionSummary" ||
        msg.role === "branchSummary" ||
        msg.role === "custom"
      ) {
        willSkip = true;
      }
    } else if (
      entry.type === "model_change" ||
      entry.type === "thinking_level_change" ||
      entry.type === "session_info"
    ) {
      willSkip = true;
    }
    // compaction and branch_summary entries → rendered as system messages, not skipped

    if (willSkip) {
      skippedParents.set(entry.id, resolvedParents.get(entry.id));
    }
  }

  // Resolve parent through skipped entries
  function resolveParent(entryId: string): string | undefined {
    let current = resolvedParents.get(entryId);
    const visited = new Set<string>();
    while (current && skippedParents.has(current)) {
      if (visited.has(current)) return undefined;
      visited.add(current);
      current = skippedParents.get(current);
    }
    return current;
  }

  // Second pass: build messages
  for (const entry of entries) {
    if (skippedParents.has(entry.id)) continue;

    const sourceRef = entry.id;
    const timestamp = entry.timestamp;
    const parentMessageRef = resolveParent(entry.id);
    const rawJson = JSON.stringify(entry);

    if (entry.type === "compaction") {
      messages.push({
        type: "system",
        sourceRef,
        timestamp,
        parentMessageRef,
        rawJson,
        content: `[Compaction] ${entry.summary}`,
      });
    } else if (entry.type === "branch_summary") {
      messages.push({
        type: "system",
        sourceRef,
        timestamp,
        parentMessageRef,
        rawJson,
        content: `[Branch summary] ${entry.summary}`,
      });
    } else if (entry.type === "message") {
      const msg = entry.message;

      if (msg.role === "user") {
        const text = extractText(msg.content);
        if (text.trim()) {
          messages.push({
            type: "user",
            sourceRef,
            timestamp,
            parentMessageRef,
            rawJson,
            content: text,
          });
        }
      } else if (msg.role === "assistant") {
        const blocks = msg.content as ContentBlock[];
        const text = extractText(blocks);
        const thinking = extractThinking(blocks);
        const piToolCalls = extractPiToolCalls(blocks);

        if (text.trim() || thinking) {
          messages.push({
            type: "assistant",
            sourceRef,
            timestamp,
            parentMessageRef,
            rawJson,
            content: text,
            thinking,
          });
        }

        if (piToolCalls.length > 0) {
          const calls: ToolCall[] = piToolCalls.map((tc) => {
            const result = toolResults.get(tc.id);
            return {
              id: tc.id,
              name: tc.name,
              summary: extractToolSummary(tc.name, tc.arguments || {}),
              input: tc.arguments,
              result: result?.result,
              error: result?.isError ? result.result : undefined,
            };
          });
          messages.push({
            type: "tool_calls",
            sourceRef,
            timestamp,
            parentMessageRef,
            rawJson,
            calls,
          });
        }
      }
    }
  }

  // Compute time bounds
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const msg of messages) {
    const t = new Date(msg.timestamp).getTime();
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
  }
  const now = new Date().toISOString();
  const startTime = Number.isFinite(minTime)
    ? new Date(minTime).toISOString()
    : now;
  const endTime = Number.isFinite(maxTime)
    ? new Date(maxTime).toISOString()
    : startTime;

  return {
    source: {
      file: sourcePath,
      adapter: "pi-coding-agent",
    },
    metadata: {
      warnings,
      messageCount: messages.length,
      startTime,
      endTime,
      cwd,
    },
    messages,
  };
}

// ============================================================================
// Adapter
// ============================================================================

export const piCodingAgentAdapter: Adapter = {
  name: "pi-coding-agent",
  version: "pi-coding-agent:1",
  defaultSource: join(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi"),
    "sessions",
  ),

  async discover(source: string): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];
    const glob = new Glob("**/*.jsonl");

    for await (const file of glob.scan({ cwd: source, absolute: false })) {
      const fullPath = join(source, file);
      try {
        const fileStat = await stat(fullPath);
        sessions.push({
          path: fullPath,
          relativePath: file,
          mtime: fileStat.mtime.getTime(),
        });
      } catch {
        // Skip files we can't stat
      }
    }

    // Try to extract session name from session_info entries
    for (const session of sessions) {
      try {
        const content = await Bun.file(session.path).text();
        const lines = content.split("\n");
        // Scan for session_info entries (last one wins)
        let name: string | undefined;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type === "session_info" && entry.name) {
              name = entry.name;
            }
          } catch {
            // skip
          }
        }
        if (name) {
          session.summary = name;
        }
      } catch {
        // skip
      }
    }

    return sessions;
  },

  parse(content: string, sourcePath: string): Transcript[] {
    const { header, entries, warnings } = parseJsonl(content);
    const cwd = header?.cwd;

    const { conversations, resolvedParents } = splitConversations(entries);

    if (conversations.length === 0) {
      const now = new Date().toISOString();
      return [
        {
          source: { file: sourcePath, adapter: "pi-coding-agent" },
          metadata: {
            warnings,
            messageCount: 0,
            startTime: now,
            endTime: now,
            cwd,
          },
          messages: [],
        },
      ];
    }

    if (conversations.length === 1) {
      return [
        transformConversation(
          conversations[0],
          sourcePath,
          warnings,
          resolvedParents,
          cwd,
        ),
      ];
    }

    return conversations.map((conv, i) =>
      transformConversation(
        conv,
        sourcePath,
        i === 0 ? warnings : [],
        resolvedParents,
        cwd,
      ),
    );
  },
};
