/**
 * Convert command: full pipeline with provenance tracking.
 *
 * When output is a directory, uses the same replace-existing behavior
 * as sync: scans for existing outputs by provenance and replaces them.
 */

import { dirname, join, resolve } from "path";
import { mkdir, stat } from "fs/promises";
import { parseToTranscripts } from "./parse.ts";
import { renderTranscript } from "./render.ts";
import { generateOutputName, type NamingOptions } from "./utils/naming.ts";
import {
  findExistingOutputs,
  deleteExistingOutputs,
} from "./utils/provenance.ts";

export interface ConvertToDirectoryOptions {
  input: string;
  outputDir: string;
  adapter?: string;
  head?: string;
  naming?: NamingOptions;
}

/**
 * Convert source file to markdown in output directory.
 * Uses provenance tracking to replace existing outputs.
 */
export async function convertToDirectory(
  options: ConvertToDirectoryOptions,
): Promise<void> {
  const { input, outputDir, adapter, head, naming } = options;

  // Parse input to transcripts
  const { transcripts, inputPath } = await parseToTranscripts({
    input,
    adapter,
  });

  // Resolve absolute source path for provenance tracking
  const sourcePath = inputPath === "<stdin>" ? "<stdin>" : resolve(inputPath);

  // Find and delete existing outputs for this source
  if (sourcePath !== "<stdin>") {
    const existingOutputs = await findExistingOutputs(outputDir, sourcePath);
    if (existingOutputs.length > 0) {
      await deleteExistingOutputs(existingOutputs);
    }
  }

  // Generate fresh outputs
  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i];
    const suffix = transcripts.length > 1 ? `_${i + 1}` : undefined;

    // Generate descriptive name
    const baseName = await generateOutputName(
      transcript,
      inputPath,
      naming || {},
    );
    const finalName = suffix ? `${baseName}${suffix}` : baseName;
    const outputPath = join(outputDir, `${finalName}.md`);

    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Render with provenance front matter
    const markdown = renderTranscript(transcript, {
      head,
      sourcePath: sourcePath !== "<stdin>" ? sourcePath : undefined,
    });
    await Bun.write(outputPath, markdown);

    console.error(`Wrote: ${outputPath}`);
  }
}
