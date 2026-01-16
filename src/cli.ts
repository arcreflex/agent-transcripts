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
} from "cmd-ts";
import { parse, parseToTranscripts } from "./parse.ts";
import { render, renderTranscript } from "./render.ts";

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
    if (output) {
      await parse({ input, output, adapter });
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
    if (output) {
      // Write intermediate JSON and markdown files
      const { outputPaths } = await parse({ input, output, adapter });
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
  },
  // Default command when no subcommand is specified
});

// Run CLI
const args = process.argv.slice(2);

// Check if first arg is a subcommand
if (args[0] === "parse" || args[0] === "render") {
  run(cli, args);
} else {
  // Run default command for full pipeline
  run(defaultCmd, args);
}
