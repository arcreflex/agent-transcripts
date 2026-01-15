import { describe, expect, it } from "bun:test";
import { join, dirname } from "path";
import { Glob } from "bun";

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

      // Run the CLI: parse to temp JSON, then render to temp MD
      const tempJson = `/tmp/test-${name}-${Date.now()}.json`;
      const tempMd = `/tmp/test-${name}-${Date.now()}.md`;

      // Parse
      const parseResult = Bun.spawnSync([
        binPath,
        "parse",
        relativeInputPath,
        "--adapter",
        "claude-code",
        "-o",
        tempJson,
      ]);
      expect(parseResult.exitCode).toBe(0);

      // Render
      const renderResult = Bun.spawnSync([
        binPath,
        "render",
        tempJson,
        "-o",
        tempMd,
      ]);
      expect(renderResult.exitCode).toBe(0);

      // Compare output
      const actualOutput = await Bun.file(tempMd).text();
      expect(actualOutput.trimEnd()).toBe(expectedOutput.trimEnd());

      // Cleanup
      await Bun.file(tempJson)
        .delete()
        .catch(() => {});
      await Bun.file(tempMd)
        .delete()
        .catch(() => {});
    });
  }
});
