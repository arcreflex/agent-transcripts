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
  type: string,
  displayName: "file",
  description: "Input file (use - for stdin)",
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
      description: "Output directory for transcripts",
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
    const naming = OPENROUTER_API_KEY
      ? { apiKey: OPENROUTER_API_KEY }
      : undefined;
    await sync({ source, output, force, quiet, naming });
  },
});

// Convert subcommand: full pipeline (parse → render) - the default
const convertCmd = command({
  name: "convert",
  description: "Full pipeline: parse source and render to markdown (default)",
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

const SUBCOMMANDS = ["convert", "parse", "render", "sync"] as const;

// Main CLI with subcommands
const cli = subcommands({
  name: "agent-transcripts",
  description: "Transform agent session files to readable transcripts",
  cmds: {
    convert: convertCmd,
    parse: parseCmd,
    render: renderCmd,
    sync: syncCmd,
  },
});

// Run CLI
const args = process.argv.slice(2);

// If first arg isn't a subcommand (and isn't a help flag), prepend "convert" as the default
const isSubcommand =
  args.length > 0 &&
  SUBCOMMANDS.includes(args[0] as (typeof SUBCOMMANDS)[number]);
const isHelpFlag =
  args.length === 0 || args[0] === "--help" || args[0] === "-h";
const effectiveArgs = isSubcommand || isHelpFlag ? args : ["convert", ...args];

run(cli, effectiveArgs);
