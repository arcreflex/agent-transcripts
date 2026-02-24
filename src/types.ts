/**
 * Intermediate transcript format for agent-transcripts.
 * Designed to be adapter-agnostic - any agent harness can produce this format.
 */

export interface Transcript {
  source: {
    file: string;
    adapter: string;
  };
  metadata: {
    warnings: Warning[];
    messageCount: number;
    startTime: string; // ISO timestamp of first message
    endTime: string; // ISO timestamp of last message
    cwd?: string; // Working directory (if known)
  };
  messages: Message[];
}

export interface Warning {
  type: string;
  detail: string;
  sourceRef?: string;
}

export type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ToolCallGroup
  | ErrorMessage;

interface BaseMessage {
  sourceRef: string;
  timestamp: string;
  parentMessageRef?: string; // UUID of parent message (for tree reconstruction)
  rawJson?: string; // Original JSON for raw view toggle
}

export interface UserMessage extends BaseMessage {
  type: "user";
  content: string;
}

export interface AssistantMessage extends BaseMessage {
  type: "assistant";
  content: string;
  thinking?: string;
}

export interface SystemMessage extends BaseMessage {
  type: "system";
  content: string;
}

export interface ToolCallGroup extends BaseMessage {
  type: "tool_calls";
  calls: ToolCall[];
}

export interface ToolCall {
  id?: string;
  name: string;
  summary: string;
  input?: Record<string, unknown>;
  result?: string;
  error?: string;
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  content: string;
}

/**
 * A session file discovered by an adapter.
 */
export interface DiscoveredSession {
  /** Absolute path to the session file. Must be absolute for archive traceability. */
  path: string;
  relativePath: string;
  mtime: number;
  /** Summary/title from the source harness, if available */
  summary?: string;
}

/**
 * Adapter interface - each source format implements this.
 */
export interface Adapter {
  name: string;
  /** Versioned identifier for cache invalidation (e.g. "claude-code:1") */
  version: string;
  /** Default source directory for auto-discovery (if the adapter has one) */
  defaultSource?: string;
  /** Discover session files in the given directory */
  discover(source: string): Promise<DiscoveredSession[]>;
  /** Parse source content into one or more transcripts (split by conversation) */
  parse(content: string, sourcePath: string): Transcript[];
}

/** An adapter paired with its source directory. */
export interface SourceSpec {
  adapter: Adapter;
  source: string;
}
