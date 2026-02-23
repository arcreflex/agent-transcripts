/**
 * Render: intermediate transcript format → markdown
 */

import type { Transcript, Message, ToolCall } from "./types.ts";
import { walkTranscriptTree } from "./utils/tree.ts";

function formatToolCall(call: ToolCall): string {
  if (call.summary) {
    return `${call.name} \`${call.summary}\``;
  }
  return call.name;
}

function formatToolCalls(calls: ToolCall[]): string {
  if (calls.length === 1) {
    return `**Tool**: ${formatToolCall(calls[0])}`;
  }
  return `**Tools**:\n${calls.map((c) => `- ${formatToolCall(c)}`).join("\n")}`;
}

function renderMessage(msg: Message): string {
  switch (msg.type) {
    case "user":
      return `## User\n\n${msg.content}`;

    case "assistant": {
      const parts: string[] = ["## Assistant"];

      if (msg.thinking) {
        parts.push(`
<details>
<summary>Thinking...</summary>

${msg.thinking}
</details>`);
      }

      if (msg.content.trim()) {
        parts.push(msg.content);
      }

      return parts.join("\n\n");
    }

    case "system":
      return `## System\n\n\`\`\`\n${msg.content}\n\`\`\``;

    case "tool_calls":
      return formatToolCalls(msg.calls);

    case "error":
      return `## Error\n\n\`\`\`\n${msg.content}\n\`\`\``;

    default:
      return "";
  }
}

export interface RenderTranscriptOptions {
  head?: string; // render branch ending at this message ID
  sourcePath?: string; // absolute source path for front matter provenance
  title?: string; // override the "# Transcript" heading
}

export function renderTranscript(
  transcript: Transcript,
  options: RenderTranscriptOptions = {},
): string {
  const { head, sourcePath, title } = options;

  const lines: string[] = [];

  // YAML front matter (for provenance tracking)
  if (sourcePath) {
    lines.push("---");
    lines.push(`source: ${sourcePath}`);
    lines.push("---");
    lines.push("");
  }

  // Header
  lines.push(`# ${title || "Transcript"}`);
  lines.push("");
  lines.push(`**Source**: \`${transcript.source.file}\``);
  lines.push(`**Adapter**: ${transcript.source.adapter}`);

  // Warnings
  if (transcript.metadata.warnings.length > 0) {
    lines.push("");
    lines.push("**Warnings**:");
    for (const w of transcript.metadata.warnings) {
      lines.push(`- ${w.type}: ${w.detail}`);
    }
  }

  lines.push("");
  lines.push("---");

  for (const event of walkTranscriptTree(transcript, { head })) {
    switch (event.type) {
      case "empty":
        break;

      case "head_not_found":
        lines.push("");
        lines.push(`**Error**: Message ID \`${event.head}\` not found`);
        break;

      case "messages":
        for (const msg of event.messages) {
          const rendered = renderMessage(msg);
          if (rendered) {
            lines.push("");
            lines.push(rendered);
          }
        }
        break;

      case "branch_note":
        lines.push("");
        lines.push("> **Other branches**:");
        for (const branch of event.branches) {
          lines.push(`> - \`${branch.sourceRef}\` "${branch.firstLine}"`);
        }
        break;
    }
  }

  return lines.join("\n");
}
