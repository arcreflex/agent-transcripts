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
import { getAdapter, getDefaultSources } from "./adapters/index.ts";
import { ArchiveWatcher } from "./watch.ts";
import type { SourceSpec } from "./types.ts";

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

/**
 * Resolve source specs from CLI args.
 * - No source: use adapter defaults
 * - Source + adapter: explicit pair
 * - Source without adapter: error
 */
function resolveSourceSpecs(
  source: string | undefined,
  adapterName: string | undefined,
): SourceSpec[] {
  if (!source) {
    const defaults = getDefaultSources();
    if (defaults.length === 0) {
      console.error("Error: no adapters have a default source directory.");
      process.exit(1);
    }
    return defaults;
  }

  if (!adapterName) {
    console.error(
      "Error: --adapter is required when specifying a source directory.",
    );
    process.exit(1);
  }

  const adapter = getAdapter(adapterName);
  if (!adapter) {
    console.error(`Error: unknown adapter "${adapterName}".`);
    process.exit(1);
  }

  return [{ adapter, source }];
}

// Archive subcommand
const archiveCmd = command({
  name: "archive",
  description: "Archive session files from source directory",
  args: {
    source: positional({
      type: optional(string),
      displayName: "source",
      description: "Source directory to scan (omit to use adapter defaults)",
    }),
    adapter: adapterOpt,
    archiveDir: archiveDirOpt,
    quiet: flag({
      long: "quiet",
      short: "q",
      description: "Suppress progress output",
    }),
  },
  async handler({ source, adapter: adapterName, archiveDir, quiet }) {
    const dir = archiveDir ?? DEFAULT_ARCHIVE_DIR;
    const specs = resolveSourceSpecs(source, adapterName);

    let totalUpdated = 0;
    let totalCurrent = 0;
    let totalErrors = 0;

    for (const spec of specs) {
      const result = await archiveAll(dir, spec.source, [spec.adapter], {
        quiet,
      });
      totalUpdated += result.updated.length;
      totalCurrent += result.current.length;
      totalErrors += result.errors.length;
    }

    if (!quiet) {
      console.error(
        `\nArchive complete: ${totalUpdated} updated, ${totalCurrent} current, ${totalErrors} errors`,
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
      type: optional(string),
      displayName: "source",
      description: "Source directory to watch (omit to use adapter defaults)",
    }),
    adapter: adapterOpt,
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
  async handler({
    source,
    adapter: adapterName,
    archiveDir,
    pollInterval,
    quiet,
  }) {
    const specs = resolveSourceSpecs(source, adapterName);

    const watcher = new ArchiveWatcher(specs, {
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

    const dirs = [...new Set(specs.map((s) => s.source))].join(", ");
    if (!quiet) {
      console.error(`Watching ${dirs}...`);
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
        console.log(renderTranscript(transcripts[i], { head }));
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
