/**
 * Parse command: source format → intermediate JSON
 */

import { basename, dirname, join } from "path";
import { mkdir } from "fs/promises";
import type { Transcript } from "./types.ts";
import { detectAdapter, getAdapter, listAdapters } from "./adapters/index.ts";

export interface ParseOptions {
  input?: string; // file path, undefined for stdin
  output?: string; // output path/dir
  adapter?: string; // explicit adapter name
}

/**
 * Read input content from file or stdin.
 */
async function readInput(
  input?: string,
): Promise<{ content: string; path: string }> {
  if (input) {
    const content = await Bun.file(input).text();
    return { content, path: input };
  }

  // Read from stdin
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
function getOutputPaths(
  transcripts: Transcript[],
  inputPath: string,
  outputOption?: string,
): string[] {
  // Determine base name
  let baseName: string;
  if (inputPath === "<stdin>") {
    baseName = "transcript";
  } else {
    const name = basename(inputPath);
    baseName = name.replace(/\.jsonl?$/, "");
  }

  // Determine output directory
  let outputDir: string;
  if (outputOption) {
    // If output looks like a file (has extension), use its directory
    if (outputOption.match(/\.\w+$/)) {
      outputDir = dirname(outputOption);
      baseName = basename(outputOption).replace(/\.\w+$/, "");
    } else {
      outputDir = outputOption;
    }
  } else {
    outputDir = process.cwd();
  }

  // Generate paths
  if (transcripts.length === 1) {
    return [join(outputDir, `${baseName}.json`)];
  }

  return transcripts.map((_, i) =>
    join(outputDir, `${baseName}_${i + 1}.json`),
  );
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
  if (!adapterName && options.input) {
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
  const outputPaths = getOutputPaths(transcripts, inputPath, options.output);

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
