import { describe, expect, it } from "bun:test";
import { join, dirname } from "path";
import { Glob } from "bun";
import { getAdapter } from "../src/adapters/index.ts";
import { renderTranscript } from "../src/render.ts";

const fixturesRoot = join(dirname(import.meta.path), "fixtures");
const binPath = join(dirname(import.meta.path), "../bin/agent-transcripts");

/** Map fixture directory name → adapter name */
const fixtureAdapters: Record<string, string> = {
  claude: "claude-code",
  "pi-coding-agent": "pi-coding-agent",
};

for (const [fixtureDir, adapterName] of Object.entries(fixtureAdapters)) {
  const fixturesDir = join(fixturesRoot, fixtureDir);

  // Find all input fixtures
  const inputFiles: string[] = [];
  const glob = new Glob("*.input.jsonl");
  for await (const file of glob.scan(fixturesDir)) {
    inputFiles.push(file);
  }
  inputFiles.sort();

  describe(`snapshot tests (${adapterName})`, () => {
    for (const inputFile of inputFiles) {
      const name = inputFile.replace(".input.jsonl", "");

      it(name, async () => {
        const inputPath = join(fixturesDir, inputFile);
        const expectedPath = inputPath.replace(".input.jsonl", ".output.md");
        const relativeInputPath = `test/fixtures/${fixtureDir}/${inputFile}`;

        const expectedOutput = await Bun.file(expectedPath).text();

        const adapter = getAdapter(adapterName)!;
        const content = await Bun.file(relativeInputPath).text();
        const transcripts = adapter.parse(content, relativeInputPath);

        expect(transcripts.length).toBeGreaterThan(0);

        const actualOutput = renderTranscript(transcripts[0]);
        expect(actualOutput.trimEnd()).toBe(expectedOutput.trimEnd());
      });
    }
  });
}

describe("CLI integration", () => {
  it("convert to stdout works (claude-code)", async () => {
    const relativeInputPath =
      "test/fixtures/claude/basic-conversation.input.jsonl";
    const expectedPath = join(
      fixturesRoot,
      "claude/basic-conversation.output.md",
    );
    const expectedOutput = await Bun.file(expectedPath).text();

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

  it("convert to stdout works (pi-coding-agent)", async () => {
    const relativeInputPath =
      "test/fixtures/pi-coding-agent/basic-conversation.input.jsonl";
    const expectedPath = join(
      fixturesRoot,
      "pi-coding-agent/basic-conversation.output.md",
    );
    const expectedOutput = await Bun.file(expectedPath).text();

    const result = Bun.spawnSync([
      binPath,
      "convert",
      relativeInputPath,
      "--adapter",
      "pi-coding-agent",
    ]);

    expect(result.exitCode).toBe(0);

    const actualOutput = result.stdout.toString();
    expect(actualOutput.trimEnd()).toBe(expectedOutput.trimEnd());
  });
});
