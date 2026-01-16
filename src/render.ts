/**
 * Render command: intermediate JSON → markdown
 */

import { basename, dirname, join } from "path";
import { mkdir } from "fs/promises";
import type { Transcript, Message, ToolCall } from "./types.ts";

export interface RenderOptions {
  input: string; // file path, or "-" for stdin
  output?: string; // output path
  head?: string; // render branch ending at this message ID
}

/**
 * Read transcript from file or stdin.
 */
async function readTranscript(
  input: string,
): Promise<{ transcript: Transcript; path: string }> {
  let content: string;
  let path: string;

  if (input !== "-") {
    content = await Bun.file(input).text();
    path = input;
  } else {
    const chunks: string[] = [];
    const reader = Bun.stdin.stream().getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    content = chunks.join("");
    path = "<stdin>";
  }

  const transcript = JSON.parse(content) as Transcript;
  return { transcript, path };
}

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

/**
 * Get first line of message content for branch reference.
 */
function getFirstLine(msg: Message): string {
  let text: string;
  switch (msg.type) {
    case "user":
    case "assistant":
    case "system":
    case "error":
      text = msg.content;
      break;
    case "tool_calls":
      text = msg.calls.map((c) => c.name).join(", ");
      break;
    default:
      text = "";
  }
  const firstLine = text.split("\n")[0].trim();
  const maxLen = 60;
  return firstLine.length > maxLen
    ? firstLine.slice(0, maxLen) + "..."
    : firstLine;
}

/**
 * Build tree structure from messages.
 * Returns maps for navigation and the messages grouped by sourceRef.
 */
function buildTree(messages: Message[]): {
  bySourceRef: Map<string, Message[]>;
  children: Map<string, Set<string>>;
  parents: Map<string, string>;
  roots: string[];
} {
  // Group messages by sourceRef
  const bySourceRef = new Map<string, Message[]>();
  for (const msg of messages) {
    const existing = bySourceRef.get(msg.sourceRef) || [];
    existing.push(msg);
    bySourceRef.set(msg.sourceRef, existing);
  }

  // Build parent → children map (at sourceRef level)
  const children = new Map<string, Set<string>>();
  const parents = new Map<string, string>();

  for (const msg of messages) {
    if (msg.parentMessageRef && bySourceRef.has(msg.parentMessageRef)) {
      parents.set(msg.sourceRef, msg.parentMessageRef);
      const existing = children.get(msg.parentMessageRef) || new Set();
      existing.add(msg.sourceRef);
      children.set(msg.parentMessageRef, existing);
    }
  }

  // Find roots (no parent in our set)
  const roots: string[] = [];
  for (const sourceRef of bySourceRef.keys()) {
    if (!parents.has(sourceRef)) {
      roots.push(sourceRef);
    }
  }

  return { bySourceRef, children, parents, roots };
}

/**
 * Find the latest leaf in the tree (for primary branch).
 */
function findLatestLeaf(
  bySourceRef: Map<string, Message[]>,
  children: Map<string, Set<string>>,
): string | undefined {
  let latestLeaf: string | undefined;
  let latestTime = 0;

  for (const sourceRef of bySourceRef.keys()) {
    const childSet = children.get(sourceRef);
    if (!childSet || childSet.size === 0) {
      // It's a leaf
      const msgs = bySourceRef.get(sourceRef);
      if (msgs && msgs.length > 0) {
        const time = new Date(msgs[0].timestamp).getTime();
        if (time > latestTime) {
          latestTime = time;
          latestLeaf = sourceRef;
        }
      }
    }
  }

  return latestLeaf;
}

/**
 * Trace path from root to target.
 */
function tracePath(target: string, parents: Map<string, string>): string[] {
  const path: string[] = [];
  let current: string | undefined = target;

  while (current) {
    path.unshift(current);
    current = parents.get(current);
  }

  return path;
}

/**
 * Render transcript to markdown with branch awareness.
 */
export function renderTranscript(
  transcript: Transcript,
  head?: string,
): string {
  const lines: string[] = [];

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

/**
 * Determine output path for markdown.
 */
function getOutputPath(inputPath: string, outputOption?: string): string {
  if (outputOption) {
    // If it has an extension, use as-is
    if (outputOption.match(/\.\w+$/)) {
      return outputOption;
    }
    // Treat as directory
    const base =
      inputPath === "<stdin>"
        ? "transcript"
        : basename(inputPath).replace(/\.json$/, "");
    return join(outputOption, `${base}.md`);
  }

  // Default: same name in cwd
  const base =
    inputPath === "<stdin>"
      ? "transcript"
      : basename(inputPath).replace(/\.json$/, "");
  return join(process.cwd(), `${base}.md`);
}

/**
 * Render intermediate JSON to markdown.
 */
export async function render(options: RenderOptions): Promise<void> {
  const { transcript, path: inputPath } = await readTranscript(options.input);

  const markdown = renderTranscript(transcript, options.head);

  if (options.output) {
    const outputPath = getOutputPath(inputPath, options.output);
    // Ensure directory exists
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, markdown);
    console.error(`Wrote: ${outputPath}`);
  } else {
    // Default: print to stdout
    console.log(markdown);
  }
}
