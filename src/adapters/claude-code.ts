/**
 * Claude Code JSONL adapter.
 *
 * Parses session files from ~/.claude/projects/{project}/sessions/{session}.jsonl
 */

import type {
  Adapter,
  Transcript,
  Message,
  Warning,
  ToolCall,
} from "../types.ts";
import { extractToolSummary } from "../utils/summary.ts";

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
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
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
 * Build message graph and find conversation boundaries.
 * Returns array of conversation groups (each is array of records in order).
 */
function splitConversations(records: ClaudeRecord[]): ClaudeRecord[][] {
  // Filter to only message records (user, assistant, system with uuid)
  const messageRecords = records.filter(
    (r) =>
      r.uuid &&
      (r.type === "user" || r.type === "assistant" || r.type === "system"),
  );

  if (messageRecords.length === 0) return [];

  // Build parent → children map
  const byUuid = new Map<string, ClaudeRecord>();
  const children = new Map<string, string[]>();

  for (const rec of messageRecords) {
    if (rec.uuid) {
      byUuid.set(rec.uuid, rec);
      const parent = rec.parentUuid;
      if (parent) {
        const existing = children.get(parent) || [];
        existing.push(rec.uuid);
        children.set(parent, existing);
      }
    }
  }

  // Find roots (no parent or parent not in our set)
  const roots: string[] = [];
  for (const rec of messageRecords) {
    if (!rec.parentUuid || !byUuid.has(rec.parentUuid)) {
      if (rec.uuid) roots.push(rec.uuid);
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

  return conversations;
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
 */
function extractToolCalls(content: string | ContentBlock[]): ToolCall[] {
  if (typeof content === "string") return [];

  return content.flatMap((b) => {
    if (b.type === "tool_use" && b.name) {
      return [
        {
          name: b.name,
          summary: extractToolSummary(b.name, b.input || {}),
        },
      ];
    }
    return [];
  });
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
  let current: string | undefined = parentUuid;
  while (current && skippedParents.has(current)) {
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
): Transcript {
  const messages: Message[] = [];
  // Track skipped message UUIDs → their parent UUIDs for chain repair
  const skippedParents = new Map<string, string | undefined>();

  // First pass: identify which messages will be skipped
  for (const rec of records) {
    if (!rec.uuid) continue;

    let willSkip = false;

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
      const toolCalls = extractToolCalls(rec.message.content);
      // Only skip if no text, no thinking, AND no tool calls
      if (!text.trim() && !thinking && toolCalls.length === 0) {
        willSkip = true;
      }
    } else if (rec.type === "system") {
      const text = rec.content || "";
      if (!text.trim()) willSkip = true;
    }

    if (willSkip) {
      skippedParents.set(rec.uuid, rec.parentUuid || undefined);
    }
  }

  // Second pass: build messages with corrected parent references
  for (const rec of records) {
    const sourceRef = rec.uuid || "";
    const timestamp = rec.timestamp || new Date().toISOString();
    const parentMessageRef = resolveParent(rec.parentUuid, skippedParents);

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
          content: text,
        });
      }
    } else if (rec.type === "assistant" && rec.message) {
      const text = extractText(rec.message.content);
      const thinking = extractThinking(rec.message.content);
      const toolCalls = extractToolCalls(rec.message.content);

      // Add assistant message if there's text or thinking
      if (text.trim() || thinking) {
        messages.push({
          type: "assistant",
          sourceRef,
          timestamp,
          parentMessageRef,
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
          content: text,
        });
      }
    }
  }

  return {
    source: {
      file: sourcePath,
      adapter: "claude-code",
    },
    metadata: { warnings },
    messages,
  };
}

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  filePatterns: ["*.jsonl"],

  parse(content: string, sourcePath: string): Transcript[] {
    const { records, warnings } = parseJsonl(content);
    const conversations = splitConversations(records);

    if (conversations.length === 0) {
      // Return single empty transcript with warnings
      return [
        {
          source: { file: sourcePath, adapter: "claude-code" },
          metadata: { warnings },
          messages: [],
        },
      ];
    }

    // For single conversation, include all warnings
    if (conversations.length === 1) {
      return [transformConversation(conversations[0], sourcePath, warnings)];
    }

    // For multiple conversations, only first gets warnings
    return conversations.map((conv, i) =>
      transformConversation(conv, sourcePath, i === 0 ? warnings : []),
    );
  },
};
