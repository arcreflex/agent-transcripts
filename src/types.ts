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
  name: string;
  summary: string;
  error?: string;
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  content: string;
}

/**
 * Adapter interface - each source format implements this.
 */
export interface Adapter {
  name: string;
  /** Glob patterns for discovering session files (e.g., ["*.jsonl"]) */
  filePatterns: string[];
  /** Parse source content into one or more transcripts (split by conversation) */
  parse(content: string, sourcePath: string): Transcript[];
}
