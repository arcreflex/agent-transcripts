import { describe, expect, it } from "bun:test";
import { join, dirname } from "path";
import { Glob } from "bun";
import { getAdapter } from "../src/adapters/index.ts";
import { renderTranscript } from "../src/render.ts";

const fixturesDir = join(dirname(import.meta.path), "fixtures/claude");
const binPath = join(dirname(import.meta.path), "../bin/agent-transcripts");

// Find all input fixtures
const inputFiles: string[] = [];
const glob = new Glob("*.input.jsonl");
for await (const file of glob.scan(fixturesDir)) {
  inputFiles.push(file);
}
inputFiles.sort();

describe("snapshot tests", () => {
  for (const inputFile of inputFiles) {
    const name = inputFile.replace(".input.jsonl", "");

    it(name, async () => {
      const inputPath = join(fixturesDir, inputFile);
      const expectedPath = inputPath.replace(".input.jsonl", ".output.md");
      // Use relative path for consistent Source: field in output
      const relativeInputPath = `test/fixtures/claude/${inputFile}`;

      const expectedOutput = await Bun.file(expectedPath).text();

      // Direct function call: parse with adapter, then render
      const adapter = getAdapter("claude-code")!;
      const content = await Bun.file(relativeInputPath).text();
      const transcripts = adapter.parse(content, relativeInputPath);

      expect(transcripts.length).toBeGreaterThan(0);

      // Render the first transcript (our fixtures are single-transcript)
      const actualOutput = renderTranscript(transcripts[0]);

      expect(actualOutput.trimEnd()).toBe(expectedOutput.trimEnd());
    });
  }
});

describe("CLI integration", () => {
  it("convert to stdout works", async () => {
    const inputFile = inputFiles[0];
    if (!inputFile) {
      throw new Error("No input fixtures found");
    }

    const relativeInputPath = `test/fixtures/claude/${inputFile}`;
    const expectedPath = join(
      fixturesDir,
      inputFile.replace(".input.jsonl", ".output.md"),
    );
    const expectedOutput = await Bun.file(expectedPath).text();

    // Run CLI: convert with stdout output
    const result = Bun.spawnSync([
      binPath,
      "convert",
      relativeInputPath,
      "--adapter",
      "claude-code",
    ]);

    expect(result.exitCode).toBe(0);

    const actualOutput = result.stdout.toString();
    expect(actualOutput.trimEnd()).toBe(expectedOutput.trimEnd());
  });
});
