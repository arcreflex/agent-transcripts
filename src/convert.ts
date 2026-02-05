/**
 * Convert command: parse source and render to markdown.
 *
 * Standalone pipeline with no archive dependency. Directory output
 * writes markdown files with deterministic names.
 */

import { join, resolve } from "path";
import { mkdir } from "fs/promises";
import { parseToTranscripts } from "./parse.ts";
import { renderTranscript } from "./render.ts";
import { generateOutputName } from "./utils/naming.ts";

export interface ConvertToDirectoryOptions {
  input: string;
  outputDir: string;
  adapter?: string;
  head?: string;
}

export async function convertToDirectory(
  options: ConvertToDirectoryOptions,
): Promise<void> {
  const { input, outputDir, adapter, head } = options;

  await mkdir(outputDir, { recursive: true });

  const { transcripts, inputPath } = await parseToTranscripts({
    input,
    adapter,
  });

  const sourcePath = inputPath === "<stdin>" ? undefined : resolve(inputPath);

  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i];
    const segmentIndex = transcripts.length > 1 ? i + 1 : undefined;

    const baseName = generateOutputName(transcript, inputPath);
    const suffix = segmentIndex ? `_${segmentIndex}` : "";
    const relativePath = `${baseName}${suffix}.md`;
    const outputPath = join(outputDir, relativePath);

    const markdown = renderTranscript(transcript, {
      head,
      sourcePath,
    });
    await Bun.write(outputPath, markdown);
    console.error(`Wrote: ${outputPath}`);
  }
}
