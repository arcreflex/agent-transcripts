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
import { parseToTranscripts } from "./parse.ts";
import { renderTranscript } from "./render.ts";
import { sync } from "./sync.ts";
import { convertToDirectory } from "./convert.ts";

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
  description: "Output directory (prints to stdout if not specified)",
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
    await sync({ source, output, force, quiet });
  },
});

/**
 * Check if output looks like a directory (no extension) vs a specific file.
 */
function isDirectoryOutput(output: string): boolean {
  return !output.match(/\.\w+$/);
}

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
    if (output && isDirectoryOutput(output)) {
      // Directory output: use provenance tracking
      await convertToDirectory({
        input,
        outputDir: output,
        adapter,
        head,
      });
    } else if (output) {
      // Explicit file output: not supported anymore (use directory)
      console.error(
        "Error: Explicit file output not supported. Use a directory path instead.",
      );
      process.exit(1);
    } else {
      // No output: stream to stdout
      const { transcripts } = await parseToTranscripts({ input, adapter });
      for (let i = 0; i < transcripts.length; i++) {
        if (i > 0) console.log(); // blank line between transcripts
        console.log(renderTranscript(transcripts[i], head));
      }
    }
  },
});

const SUBCOMMANDS = ["convert", "sync"] as const;

// Main CLI with subcommands
const cli = subcommands({
  name: "agent-transcripts",
  description: "Transform agent session files to readable transcripts",
  cmds: {
    convert: convertCmd,
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
