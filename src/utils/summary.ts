/**
 * Extract one-line summaries from tool call inputs.
 */

import { truncate } from "./text.ts";

type ToolInput = Record<string, unknown>;

const extractors: Record<string, (input: ToolInput) => string> = {
  Read: (i) => String(i.file_path || i.path || ""),
  Write: (i) => String(i.file_path || i.path || ""),
  Edit: (i) => String(i.file_path || i.path || ""),
  Bash: (i) => {
    if (i.description) return String(i.description);
    if (i.command) return truncate(String(i.command), 60);
    return "";
  },
  Grep: (i) => {
    const pattern = String(i.pattern || "");
    const path = i.path ? ` in ${i.path}` : "";
    return truncate(pattern + path, 80);
  },
  Glob: (i) => String(i.pattern || ""),
  WebFetch: (i) => String(i.url || ""),
  WebSearch: (i) => String(i.query || ""),
  Task: (i) => truncate(String(i.description || i.prompt || ""), 60),
  TodoWrite: () => "update todos",
  AskUserQuestion: () => "ask user",
  NotebookEdit: (i) => String(i.notebook_path || ""),
};

export function extractToolSummary(toolName: string, input: ToolInput): string {
  const extractor = extractors[toolName];
  if (extractor) {
    const summary = extractor(input);
    if (summary) return summary;
  }
  // Fallback: just use tool name
  return "";
}
