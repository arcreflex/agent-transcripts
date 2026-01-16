/**
 * CLI entry point using cmd-ts.
 */

import {
  command,
  subcommands,
  run,
  string,
  option,
  optional,
  positional,
  flag,
} from "cmd-ts";
import { parse, parseToTranscripts } from "./parse.ts";
import { render, renderTranscript } from "./render.ts";
import { sync } from "./sync.ts";

// Read OpenRouter API key from environment for LLM-based slug generation
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Shared options
const inputArg = positional({
  type: optional(string),
  displayName: "file",
  description: "Input file (reads from stdin if not provided)",
});

const outputOpt = option({
  type: optional(string),
  long: "output",
  short: "o",
  description: "Output path (prints to stdout if not specified)",
});

const adapterOpt = option({
  type: optional(string),
  long: "adapter",
  description:
    "Source format adapter (auto-detected from path if not specified)",
});

const headOpt = option({
  type: optional(string),
  long: "head",
  description: "Render branch ending at this message ID (default: latest)",
});

// Parse subcommand
const parseCmd = command({
  name: "parse",
  description: "Parse source format to intermediate JSON",
  args: {
    input: inputArg,
    output: outputOpt,
    adapter: adapterOpt,
  },
  async handler({ input, output, adapter }) {
    const naming = OPENROUTER_API_KEY
      ? { apiKey: OPENROUTER_API_KEY }
      : undefined;

    if (output) {
      await parse({ input, output, adapter, naming });
    } else {
      // Print JSONL to stdout (one transcript per line)
      const { transcripts } = await parseToTranscripts({ input, adapter });
      for (const transcript of transcripts) {
        console.log(JSON.stringify(transcript));
      }
    }
  },
});

// Render subcommand
const renderCmd = command({
  name: "render",
  description: "Render intermediate JSON to markdown",
  args: {
    input: inputArg,
    output: outputOpt,
    head: headOpt,
  },
  async handler({ input, output, head }) {
    await render({ input, output, head });
  },
});

// Sync subcommand
const syncCmd = command({
  name: "sync",
  description: "Sync session files to markdown transcripts",
  args: {
    source: positional({
      type: string,
      displayName: "source",
      description: "Source directory to scan for session files",
    }),
    output: option({
      type: string,
      long: "output",
      short: "o",
      description: "Output directory (mirrors source structure)",
    }),
    force: flag({
      long: "force",
      short: "f",
      description: "Re-render all sessions, ignoring mtime",
    }),
    quiet: flag({
      long: "quiet",
      short: "q",
      description: "Suppress progress output",
    }),
  },
  async handler({ source, output, force, quiet }) {
    await sync({ source, output, force, quiet });
  },
});

// Default command: full pipeline (parse → render)
const defaultCmd = command({
  name: "agent-transcripts",
  description: "Transform agent session files to readable transcripts",
  args: {
    input: inputArg,
    output: outputOpt,
    adapter: adapterOpt,
    head: headOpt,
  },
  async handler({ input, output, adapter, head }) {
    const naming = OPENROUTER_API_KEY
      ? { apiKey: OPENROUTER_API_KEY }
      : undefined;

    if (output) {
      // Write intermediate JSON and markdown files
      const { outputPaths } = await parse({ input, output, adapter, naming });
      for (const jsonPath of outputPaths) {
        const mdPath = jsonPath.replace(/\.json$/, ".md");
        await render({ input: jsonPath, output: mdPath, head });
      }
    } else {
      // Stream to stdout - no intermediate files
      const { transcripts } = await parseToTranscripts({ input, adapter });
      for (let i = 0; i < transcripts.length; i++) {
        if (i > 0) console.log(); // blank line between transcripts
        console.log(renderTranscript(transcripts[i], head));
      }
    }
  },
});

// Main CLI with subcommands
const cli = subcommands({
  name: "agent-transcripts",
  description: "Transform agent session files to readable transcripts",
  cmds: {
    parse: parseCmd,
    render: renderCmd,
    sync: syncCmd,
  },
  // Default command when no subcommand is specified
});

// Run CLI
const args = process.argv.slice(2);

// Check if first arg is a subcommand
if (args[0] === "parse" || args[0] === "render" || args[0] === "sync") {
  run(cli, args);
} else {
  // Run default command for full pipeline
  run(defaultCmd, args);
}
