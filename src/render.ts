/**
 * Render: intermediate transcript format → markdown
 */

import type { Transcript, Message, ToolCall } from "./types.ts";
import {
  buildTree,
  findLatestLeaf,
  tracePath,
  getFirstLine,
} from "./utils/tree.ts";

/**
 * Format a single tool call.
 */
function formatToolCall(call: ToolCall): string {
  if (call.summary) {
    return `${call.name} \`${call.summary}\``;
  }
  return call.name;
}

/**
 * Format tool calls group.
 */
function formatToolCalls(calls: ToolCall[]): string {
  if (calls.length === 1) {
    return `**Tool**: ${formatToolCall(calls[0])}`;
  }
  return `**Tools**:\n${calls.map((c) => `- ${formatToolCall(c)}`).join("\n")}`;
}

/**
 * Render a message to markdown.
 */
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
}

/**
 * Render transcript to markdown with branch awareness.
 */
export function renderTranscript(
  transcript: Transcript,
  options: RenderTranscriptOptions | string = {},
): string {
  // Support legacy signature: renderTranscript(transcript, head?: string)
  const opts: RenderTranscriptOptions =
    typeof options === "string" ? { head: options } : options;
  const { head, sourcePath } = opts;

  const lines: string[] = [];

  // YAML front matter (for provenance tracking)
  if (sourcePath) {
    lines.push("---");
    lines.push(`source: ${sourcePath}`);
    lines.push("---");
    lines.push("");
  }

  // Header
  lines.push("# Transcript");
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

  // Handle empty transcripts
  if (transcript.messages.length === 0) {
    return lines.join("\n");
  }

  // Build tree
  const { bySourceRef, children, parents, roots } = buildTree(
    transcript.messages,
  );

  // Determine target (head or latest leaf)
  let target: string | undefined;
  if (head) {
    if (!bySourceRef.has(head)) {
      lines.push("");
      lines.push(`**Error**: Message ID \`${head}\` not found`);
      return lines.join("\n");
    }
    target = head;
  } else {
    target = findLatestLeaf(bySourceRef, children);
  }

  if (!target) {
    // Fallback: just render all messages in order (shouldn't happen normally)
    for (const msg of transcript.messages) {
      const rendered = renderMessage(msg);
      if (rendered) {
        lines.push("");
        lines.push(rendered);
      }
    }
    return lines.join("\n");
  }

  // Trace path from root to target
  const path = tracePath(target, parents);
  const pathSet = new Set(path);

  // Render messages along the path
  for (const sourceRef of path) {
    const msgs = bySourceRef.get(sourceRef);
    if (!msgs) continue;

    // Render all messages from this source
    for (const msg of msgs) {
      const rendered = renderMessage(msg);
      if (rendered) {
        lines.push("");
        lines.push(rendered);
      }
    }

    // Check for other branches at this point (only if not using explicit --head)
    if (!head) {
      const childSet = children.get(sourceRef);
      if (childSet && childSet.size > 1) {
        const otherBranches = [...childSet].filter((c) => !pathSet.has(c));
        if (otherBranches.length > 0) {
          lines.push("");
          lines.push("> **Other branches**:");
          for (const branchRef of otherBranches) {
            const branchMsgs = bySourceRef.get(branchRef);
            if (branchMsgs && branchMsgs.length > 0) {
              const firstLine = getFirstLine(branchMsgs[0]);
              lines.push(`> - \`${branchRef}\` "${firstLine}"`);
            }
          }
        }
      }
    }
  }

  return lines.join("\n");
}
