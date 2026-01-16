/**
 * Parse command: source format → intermediate JSON
 */

import { dirname, join } from "path";
import { mkdir } from "fs/promises";
import type { Transcript } from "./types.ts";
import { detectAdapter, getAdapter, listAdapters } from "./adapters/index.ts";
import { generateOutputName, type NamingOptions } from "./utils/naming.ts";

export interface ParseOptions {
  input: string; // file path, or "-" for stdin
  output?: string; // output path/dir
  adapter?: string; // explicit adapter name
  naming?: NamingOptions; // options for output file naming
}

/**
 * Read input content from file or stdin.
 */
async function readInput(
  input: string,
): Promise<{ content: string; path: string }> {
  if (input !== "-") {
    const content = await Bun.file(input).text();
    return { content, path: input };
  }

  // Read from stdin (when input is "-")
  const chunks: string[] = [];
  const reader = Bun.stdin.stream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new TextDecoder().decode(value));
  }

  return { content: chunks.join(""), path: "<stdin>" };
}

/**
 * Determine output file paths for transcripts.
 */
async function getOutputPaths(
  transcripts: Transcript[],
  inputPath: string,
  outputOption?: string,
  namingOptions?: NamingOptions,
): Promise<string[]> {
  // Determine output directory
  let outputDir: string;
  let explicitBaseName: string | undefined;

  if (outputOption) {
    // If output looks like a file (has extension), use its directory and name
    if (outputOption.match(/\.\w+$/)) {
      outputDir = dirname(outputOption);
      explicitBaseName = outputOption
        .split("/")
        .pop()!
        .replace(/\.\w+$/, "");
    } else {
      outputDir = outputOption;
    }
  } else {
    outputDir = process.cwd();
  }

  // Generate paths with descriptive names
  const paths: string[] = [];

  for (let i = 0; i < transcripts.length; i++) {
    let baseName: string;

    if (explicitBaseName) {
      // User provided explicit filename
      baseName = explicitBaseName;
    } else {
      // Generate descriptive name
      baseName = await generateOutputName(
        transcripts[i],
        inputPath,
        namingOptions || {},
      );
    }

    // Add suffix for multiple transcripts
    if (transcripts.length > 1) {
      baseName = `${baseName}_${i + 1}`;
    }

    paths.push(join(outputDir, `${baseName}.json`));
  }

  return paths;
}

export interface ParseResult {
  transcripts: Transcript[];
  inputPath: string;
}

export interface ParseAndWriteResult extends ParseResult {
  outputPaths: string[];
}

/**
 * Parse source file(s) to transcripts (no file I/O beyond reading input).
 */
export async function parseToTranscripts(
  options: ParseOptions,
): Promise<ParseResult> {
  const { content, path: inputPath } = await readInput(options.input);

  // Determine adapter
  let adapterName = options.adapter;
  if (!adapterName && options.input !== "-") {
    adapterName = detectAdapter(options.input);
  }

  if (!adapterName) {
    throw new Error(
      `Could not detect adapter for input. Use --adapter to specify. Available: ${listAdapters().join(", ")}`,
    );
  }

  const adapter = getAdapter(adapterName);
  if (!adapter) {
    throw new Error(
      `Unknown adapter: ${adapterName}. Available: ${listAdapters().join(", ")}`,
    );
  }

  const transcripts = adapter.parse(content, inputPath);
  return { transcripts, inputPath };
}

/**
 * Parse source file(s) to intermediate JSON and write to files.
 */
export async function parse(
  options: ParseOptions,
): Promise<ParseAndWriteResult> {
  const { transcripts, inputPath } = await parseToTranscripts(options);

  // Write output files
  const outputPaths = await getOutputPaths(
    transcripts,
    inputPath,
    options.output,
    options.naming,
  );

  for (let i = 0; i < transcripts.length; i++) {
    const json = JSON.stringify(transcripts[i], null, 2);
    // Ensure directory exists
    const dir = dirname(outputPaths[i]);
    await mkdir(dir, { recursive: true });
    await Bun.write(outputPaths[i], json);
    console.error(`Wrote: ${outputPaths[i]}`);
  }

  return { transcripts, inputPath, outputPaths };
}
