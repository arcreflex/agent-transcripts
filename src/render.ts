/**
 * Render command: intermediate JSON → markdown
 */

import { basename, dirname, join } from "path";
import { mkdir } from "fs/promises";
import type { Transcript, Message, ToolCall } from "./types.ts";

export interface RenderOptions {
  input?: string; // file path, undefined for stdin
  output?: string; // output path
}

/**
 * Read transcript from file or stdin.
 */
async function readTranscript(
  input?: string,
): Promise<{ transcript: Transcript; path: string }> {
  let content: string;
  let path: string;

  if (input) {
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
 * Render transcript to markdown.
 */
function renderTranscript(transcript: Transcript): string {
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

  // Messages
  for (const msg of transcript.messages) {
    const rendered = renderMessage(msg);
    if (rendered) {
      lines.push("");
      lines.push(rendered);
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

  const markdown = renderTranscript(transcript);
  const outputPath = getOutputPath(inputPath, options.output);

  // Ensure directory exists
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, markdown);
  console.error(`Wrote: ${outputPath}`);
}
