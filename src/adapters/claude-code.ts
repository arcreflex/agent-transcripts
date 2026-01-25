/**
 * Claude Code JSONL adapter.
 *
 * Parses session files from ~/.claude/projects/{project}/sessions/{session}.jsonl
 */

import { Glob } from "bun";
import { basename, join, relative } from "path";
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

/**
 * Claude Code sessions-index.json structure.
 */
interface SessionsIndex {
  version: number;
  entries: SessionIndexEntry[];
}

interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  isSidechain: boolean;
}

// Claude Code JSONL record types
interface ClaudeRecord {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
  content?: string;
  subtype?: string;
  cwd?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown; // Can be string, array, or other structure
}

/**
 * Parse JSONL content with best-effort error recovery.
 */
function parseJsonl(content: string): {
  records: ClaudeRecord[];
  warnings: Warning[];
} {
  const records: ClaudeRecord[] = [];
  const warnings: Warning[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const record = JSON.parse(line) as ClaudeRecord;
      records.push(record);
    } catch (e) {
      warnings.push({
        type: "parse_error",
        detail: `Line ${i + 1}: ${e instanceof Error ? e.message : "Invalid JSON"}`,
      });
    }
  }

  return { records, warnings };
}

/**
 * Find the nearest message ancestor by walking up the parent chain.
 * Returns undefined if no message ancestor exists.
 */
function findMessageAncestor(
  parentUuid: string | null | undefined,
  allByUuid: Map<string, ClaudeRecord>,
  messageUuids: Set<string>,
): string | undefined {
  const visited = new Set<string>();
  let current = parentUuid;
  while (current) {
    if (visited.has(current)) {
      return undefined; // Cycle detected
    }
    visited.add(current);
    if (messageUuids.has(current)) {
      return current;
    }
    const rec = allByUuid.get(current);
    current = rec?.parentUuid ?? null;
  }
  return undefined;
}

interface SplitResult {
  conversations: ClaudeRecord[][];
  /** Map from message UUID to its resolved parent (nearest message ancestor) */
  resolvedParents: Map<string, string | undefined>;
}

/**
 * Build message graph and find conversation boundaries.
 * Returns conversations and a map of resolved parent references.
 */
function splitConversations(records: ClaudeRecord[]): SplitResult {
  // Filter to only message records (user, assistant, system with uuid)
  const messageRecords = records.filter(
    (r) =>
      r.uuid &&
      (r.type === "user" || r.type === "assistant" || r.type === "system"),
  );

  if (messageRecords.length === 0) {
    return { conversations: [], resolvedParents: new Map() };
  }

  // Build UUID lookup for ALL records to track parent chains through non-messages
  const allByUuid = new Map<string, ClaudeRecord>();
  for (const rec of records) {
    if (rec.uuid) {
      allByUuid.set(rec.uuid, rec);
    }
  }

  // Set of message UUIDs for quick lookup
  const messageUuids = new Set<string>();
  for (const rec of messageRecords) {
    if (rec.uuid) messageUuids.add(rec.uuid);
  }

  // Build parent → children map, resolving through non-message records
  // Also track resolved parents for use in transformation
  const byUuid = new Map<string, ClaudeRecord>();
  const children = new Map<string, string[]>();
  const resolvedParents = new Map<string, string | undefined>();
  const roots: string[] = [];

  for (const rec of messageRecords) {
    if (!rec.uuid) continue;
    byUuid.set(rec.uuid, rec);

    // Find nearest message ancestor (walking through non-message records)
    const ancestor = findMessageAncestor(
      rec.parentUuid,
      allByUuid,
      messageUuids,
    );

    // Store resolved parent for this message
    resolvedParents.set(rec.uuid, ancestor);

    if (ancestor) {
      const existing = children.get(ancestor) || [];
      existing.push(rec.uuid);
      children.set(ancestor, existing);
    } else {
      // No message ancestor - this is a root
      roots.push(rec.uuid);
    }
  }

  // BFS from each root to collect conversation
  const visited = new Set<string>();
  const conversations: ClaudeRecord[][] = [];

  for (const root of roots) {
    if (visited.has(root)) continue;

    const conversation: ClaudeRecord[] = [];
    const queue = [root];

    while (queue.length > 0) {
      const uuid = queue.shift();
      if (!uuid || visited.has(uuid)) continue;
      visited.add(uuid);

      const rec = byUuid.get(uuid);
      if (rec) conversation.push(rec);

      // Add children to queue
      const childUuids = children.get(uuid) || [];
      queue.push(...childUuids);
    }

    // Note: we don't sort here - renderer handles ordering via tree traversal
    if (conversation.length > 0) {
      conversations.push(conversation);
    }
  }

  // Sort conversations by their first message timestamp
  conversations.sort((a, b) => {
    const ta = a[0]?.timestamp ? new Date(a[0].timestamp).getTime() : 0;
    const tb = b[0]?.timestamp ? new Date(b[0].timestamp).getTime() : 0;
    return ta - tb;
  });

  return { conversations, resolvedParents };
}

/**
 * Extract text content from message content blocks.
 */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;

  return content
    .flatMap((b) => (b.type === "text" && b.text ? [b.text] : []))
    .join("\n");
}

/**
 * Extract thinking from content blocks.
 */
function extractThinking(content: string | ContentBlock[]): string | undefined {
  if (typeof content === "string") return undefined;

  const thinking = content
    .flatMap((b) => (b.type === "thinking" && b.thinking ? [b.thinking] : []))
    .join("\n\n");

  return thinking || undefined;
}

/**
 * Extract tool calls from content blocks.
 * Matches with results from the toolResults map.
 */
function extractToolCalls(
  content: string | ContentBlock[],
  toolResults: Map<string, string>,
): ToolCall[] {
  if (typeof content === "string") return [];

  return content.flatMap((b) => {
    if (b.type === "tool_use" && b.name && b.id) {
      const result = toolResults.get(b.id);
      return [
        {
          name: b.name,
          summary: extractToolSummary(b.name, b.input || {}),
          input: b.input,
          result,
        },
      ];
    }
    return [];
  });
}

/**
 * Safely convert tool result content to string.
 * Content can be a string, array, or other structure.
 */
function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  // For arrays or objects, JSON stringify for display
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/**
 * Extract tool results from content blocks.
 * Returns a map of tool_use_id → result content.
 */
function extractToolResults(
  content: string | ContentBlock[],
): Map<string, string> {
  const results = new Map<string, string>();
  if (typeof content === "string") return results;

  for (const b of content) {
    if (b.type === "tool_result" && b.tool_use_id && b.content !== undefined) {
      results.set(b.tool_use_id, stringifyToolResult(b.content));
    }
  }
  return results;
}

/**
 * Check if a user message contains only tool results (no actual user text).
 */
function isToolResultOnly(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return false;

  const hasToolResult = content.some((b) => b.type === "tool_result");
  const hasText = content.some((b) => b.type === "text" && b.text?.trim());

  return hasToolResult && !hasText;
}

/**
 * Resolve a parent reference through any skipped messages.
 * When messages are skipped (e.g., tool-result-only user messages),
 * we redirect parent references to the skipped message's parent.
 */
function resolveParent(
  parentUuid: string | null | undefined,
  skippedParents: Map<string, string | undefined>,
): string | undefined {
  if (!parentUuid) return undefined;

  // Follow the chain through any skipped messages
  const visited = new Set<string>();
  let current: string | undefined = parentUuid;
  while (current && skippedParents.has(current)) {
    if (visited.has(current)) {
      return undefined; // Cycle detected
    }
    visited.add(current);
    current = skippedParents.get(current);
  }

  return current;
}

/**
 * Transform a conversation into our intermediate format.
 */
function transformConversation(
  records: ClaudeRecord[],
  sourcePath: string,
  warnings: Warning[],
  resolvedParents: Map<string, string | undefined>,
): Transcript {
  const messages: Message[] = [];
  // Track skipped message UUIDs → their resolved parent UUIDs for chain repair
  const skippedParents = new Map<string, string | undefined>();

  // Collect all tool results from user messages (tool_use_id → result)
  const allToolResults = new Map<string, string>();
  for (const rec of records) {
    if (rec.type === "user" && rec.message) {
      const results = extractToolResults(rec.message.content);
      for (const [id, content] of results) {
        allToolResults.set(id, content);
      }
    }
  }

  let cwd: string | undefined;

  // First pass: identify which messages will be skipped
  for (const rec of records) {
    if (!rec.uuid) continue;

    let willSkip = false;

    // Take the first cwd we find.
    if (!cwd && rec.cwd) {
      cwd = rec.cwd;
    }

    if (rec.type === "user" && rec.message) {
      if (isToolResultOnly(rec.message.content)) {
        willSkip = true;
      } else {
        const text = extractText(rec.message.content);
        if (!text.trim()) willSkip = true;
      }
    } else if (rec.type === "assistant" && rec.message) {
      const text = extractText(rec.message.content);
      const thinking = extractThinking(rec.message.content);
      const toolCalls = extractToolCalls(rec.message.content, allToolResults);
      // Only skip if no text, no thinking, AND no tool calls
      if (!text.trim() && !thinking && toolCalls.length === 0) {
        willSkip = true;
      }
    } else if (rec.type === "system") {
      const text = rec.content || "";
      if (!text.trim()) willSkip = true;
    }

    if (willSkip) {
      // Use the resolved parent (already walked through non-message records)
      skippedParents.set(rec.uuid, resolvedParents.get(rec.uuid));
    }
  }

  // Second pass: build messages with corrected parent references
  for (const rec of records) {
    const sourceRef = rec.uuid || "";
    const timestamp = rec.timestamp || new Date().toISOString();
    // Start with the resolved parent (through non-message records),
    // then walk through any skipped messages
    const parentMessageRef = rec.uuid
      ? resolveParent(resolvedParents.get(rec.uuid), skippedParents)
      : undefined;
    const rawJson = JSON.stringify(rec);

    if (rec.type === "user" && rec.message) {
      // Skip tool-result-only user messages (they're just tool responses)
      if (isToolResultOnly(rec.message.content)) continue;

      const text = extractText(rec.message.content);
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
    } else if (rec.type === "assistant" && rec.message) {
      const text = extractText(rec.message.content);
      const thinking = extractThinking(rec.message.content);
      const toolCalls = extractToolCalls(rec.message.content, allToolResults);

      // Add assistant message if there's text or thinking
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

      // Add tool calls as separate group
      if (toolCalls.length > 0) {
        messages.push({
          type: "tool_calls",
          sourceRef,
          timestamp,
          parentMessageRef,
          rawJson,
          calls: toolCalls,
        });
      }
    } else if (rec.type === "system") {
      const text = rec.content || "";
      if (text.trim()) {
        messages.push({
          type: "system",
          sourceRef,
          timestamp,
          parentMessageRef,
          rawJson,
          content: text,
        });
      }
    }
  }

  const firstTimestamp = messages[0]?.timestamp || new Date().toISOString();
  const lastTimestamp =
    messages[messages.length - 1]?.timestamp || firstTimestamp;

  return {
    source: {
      file: sourcePath,
      adapter: "claude-code",
    },
    metadata: {
      warnings,
      messageCount: messages.length,
      startTime: firstTimestamp,
      endTime: lastTimestamp,
      cwd,
    },
    messages,
  };
}

/**
 * Discover sessions from sessions-index.json.
 * Returns undefined if index doesn't exist or is invalid.
 */
async function discoverFromIndex(
  source: string,
): Promise<DiscoveredSession[] | undefined> {
  const indexPath = join(source, "sessions-index.json");

  try {
    const content = await Bun.file(indexPath).text();
    const index: SessionsIndex = JSON.parse(content);

    if (index.version !== 1 || !Array.isArray(index.entries)) {
      return undefined;
    }

    const sessions: DiscoveredSession[] = [];

    for (const entry of index.entries) {
      // Skip sidechains (subagents)
      if (entry.isSidechain) continue;

      // Verify the file exists and get current mtime
      try {
        const fileStat = await stat(entry.fullPath);
        sessions.push({
          path: entry.fullPath,
          relativePath:
            relative(source, entry.fullPath) || basename(entry.fullPath),
          mtime: fileStat.mtime.getTime(),
        });
      } catch {
        // Skip files that no longer exist
      }
    }

    return sessions;
  } catch {
    // Index doesn't exist or is invalid
    return undefined;
  }
}

/**
 * Discover sessions via glob pattern fallback.
 */
async function discoverByGlob(source: string): Promise<DiscoveredSession[]> {
  const sessions: DiscoveredSession[] = [];
  const glob = new Glob("**/*.jsonl");

  for await (const file of glob.scan({ cwd: source, absolute: false })) {
    // Skip files in subagents directories
    if (file.includes("/subagents/")) continue;

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

  return sessions;
}

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",

  async discover(source: string): Promise<DiscoveredSession[]> {
    // Try index-based discovery first, fall back to glob
    const fromIndex = await discoverFromIndex(source);
    return fromIndex ?? (await discoverByGlob(source));
  },

  parse(content: string, sourcePath: string): Transcript[] {
    const { records, warnings } = parseJsonl(content);
    const { conversations, resolvedParents } = splitConversations(records);

    if (conversations.length === 0) {
      // Return single empty transcript with warnings
      const now = new Date().toISOString();
      return [
        {
          source: { file: sourcePath, adapter: "claude-code" },
          metadata: {
            warnings,
            messageCount: 0,
            startTime: now,
            endTime: now,
            cwd: undefined,
          },
          messages: [],
        },
      ];
    }

    // For single conversation, include all warnings
    if (conversations.length === 1) {
      return [
        transformConversation(
          conversations[0],
          sourcePath,
          warnings,
          resolvedParents,
        ),
      ];
    }

    // For multiple conversations, only first gets warnings
    return conversations.map((conv, i) =>
      transformConversation(
        conv,
        sourcePath,
        i === 0 ? warnings : [],
        resolvedParents,
      ),
    );
  },
};
