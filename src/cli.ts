/**
 * CLI entry point using cmd-ts.
 */

import {
  command,
  subcommands,
  run,
  string,
  number,
  option,
  optional,
  positional,
  flag,
} from "cmd-ts";
import { parseToTranscripts } from "./parse.ts";
import { renderTranscript } from "./render.ts";
import { convertToDirectory } from "./convert.ts";
import { generateTitles } from "./title.ts";
import { serve } from "./serve.ts";
import { archiveAll, DEFAULT_ARCHIVE_DIR } from "./archive.ts";
import { getAdapters } from "./adapters/index.ts";
import { ArchiveWatcher } from "./watch.ts";

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

const archiveDirOpt = option({
  type: optional(string),
  long: "archive-dir",
  description: `Archive directory (default: ${DEFAULT_ARCHIVE_DIR})`,
});

// Archive subcommand
const archiveCmd = command({
  name: "archive",
  description: "Archive session files from source directory",
  args: {
    source: positional({
      type: string,
      displayName: "source",
      description: "Source directory to scan for session files",
    }),
    archiveDir: archiveDirOpt,
    quiet: flag({
      long: "quiet",
      short: "q",
      description: "Suppress progress output",
    }),
  },
  async handler({ source, archiveDir, quiet }) {
    const dir = archiveDir ?? DEFAULT_ARCHIVE_DIR;
    const result = await archiveAll(dir, source, getAdapters(), { quiet });

    if (!quiet) {
      console.error(
        `\nArchive complete: ${result.updated.length} updated, ${result.current.length} current, ${result.errors.length} errors`,
      );
    }
  },
});

// Title subcommand
const titleCmd = command({
  name: "title",
  description: "Generate LLM titles for archive entries",
  args: {
    archiveDir: archiveDirOpt,
    force: flag({
      long: "force",
      short: "f",
      description: "Regenerate all titles, not just missing ones",
    }),
    quiet: flag({
      long: "quiet",
      short: "q",
      description: "Suppress progress output",
    }),
  },
  async handler({ archiveDir, force, quiet }) {
    await generateTitles({
      archiveDir: archiveDir ?? undefined,
      force,
      quiet,
    });
  },
});

// Serve subcommand
const serveCmd = command({
  name: "serve",
  description: "Serve transcripts from archive via HTTP",
  args: {
    archiveDir: archiveDirOpt,
    port: option({
      type: optional(number),
      long: "port",
      short: "p",
      description: "Port to listen on (default: 3000)",
    }),
    quiet: flag({
      long: "quiet",
      short: "q",
      description: "Suppress request logging",
    }),
  },
  async handler({ archiveDir, port, quiet }) {
    await serve({
      archiveDir: archiveDir ?? undefined,
      port: port ?? 3000,
      quiet,
    });
  },
});

// Watch subcommand
const watchCmd = command({
  name: "watch",
  description: "Watch source directories and keep archive updated",
  args: {
    source: positional({
      type: string,
      displayName: "source",
      description: "Source directory to watch for session files",
    }),
    archiveDir: archiveDirOpt,
    pollInterval: option({
      type: optional(number),
      long: "poll-interval",
      description: "Poll interval in milliseconds (default: 30000)",
    }),
    quiet: flag({
      long: "quiet",
      short: "q",
      description: "Suppress progress output",
    }),
  },
  async handler({ source, archiveDir, pollInterval, quiet }) {
    const watcher = new ArchiveWatcher([source], {
      archiveDir: archiveDir ?? undefined,
      pollIntervalMs: pollInterval ?? undefined,
      quiet,
      onUpdate(result) {
        if (!quiet && result.updated.length > 0) {
          console.error(`Updated: ${result.updated.join(", ")}`);
        }
      },
      onError(error) {
        console.error(`Watch error: ${error.message}`);
      },
    });

    if (!quiet) {
      console.error(`Watching ${source}...`);
    }

    await watcher.start();

    process.on("SIGINT", () => {
      if (!quiet) {
        console.error("\nStopping watcher...");
      }
      watcher.stop();
      process.exit(0);
    });
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
      await convertToDirectory({
        input,
        outputDir: output,
        adapter,
        head,
      });
    } else if (output) {
      console.error(
        "Error: Explicit file output not supported. Use a directory path instead.",
      );
      process.exit(1);
    } else {
      const { transcripts } = await parseToTranscripts({ input, adapter });
      for (let i = 0; i < transcripts.length; i++) {
        if (i > 0) console.log();
        console.log(renderTranscript(transcripts[i], head));
      }
    }
  },
});

const SUBCOMMANDS = ["convert", "archive", "title", "serve", "watch"] as const;

// Main CLI with subcommands
const cli = subcommands({
  name: "agent-transcripts",
  description: "Transform agent session files to readable transcripts",
  cmds: {
    convert: convertCmd,
    archive: archiveCmd,
    title: titleCmd,
    serve: serveCmd,
    watch: watchCmd,
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
