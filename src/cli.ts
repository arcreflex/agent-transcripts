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
import { parse } from "./parse.ts";
import { render } from "./render.ts";

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
  description: "Output path (defaults to current directory)",
});

const adapterOpt = option({
  type: optional(string),
  long: "adapter",
  description:
    "Source format adapter (auto-detected from path if not specified)",
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
    await parse({ input, output, adapter });
  },
});

// Render subcommand
const renderCmd = command({
  name: "render",
  description: "Render intermediate JSON to markdown",
  args: {
    input: inputArg,
    output: outputOpt,
  },
  async handler({ input, output }) {
    await render({ input, output });
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
  },
  async handler({ input, output, adapter }) {
    // Parse to JSON - parse() determines output paths and returns them
    const { outputPaths } = await parse({ input, output, adapter });

    // Render each transcript (JSON path → markdown path)
    for (const jsonPath of outputPaths) {
      const mdPath = jsonPath.replace(/\.json$/, ".md");
      await render({ input: jsonPath, output: mdPath });
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
