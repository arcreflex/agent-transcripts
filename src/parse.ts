/**
 * Parse: source format → intermediate transcript format
 */

import type { Transcript } from "./types.ts";
import { detectAdapter, getAdapter, listAdapters } from "./adapters/index.ts";

export interface ParseOptions {
  input: string; // file path, or "-" for stdin
  adapter?: string; // explicit adapter name
}

export interface ParseResult {
  transcripts: Transcript[];
  inputPath: string;
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
 * Parse source file(s) to transcripts.
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
