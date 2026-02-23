import { describe, expect, it } from "bun:test";
import {
  getDefaultSources,
  getAdapter,
  detectAdapter,
} from "../src/adapters/index.ts";
import { claudeCodeAdapter } from "../src/adapters/claude-code.ts";
import { piCodingAgentAdapter } from "../src/adapters/pi-coding-agent.ts";

describe("getDefaultSources", () => {
  it("returns claude-code with its defaultSource", () => {
    const specs = getDefaultSources();
    expect(specs.length).toBeGreaterThanOrEqual(1);

    const cc = specs.find((s) => s.adapter.name === "claude-code");
    expect(cc).toBeDefined();
    expect(cc?.adapter).toBe(claudeCodeAdapter);
    expect(typeof cc?.source).toBe("string");
    expect(cc?.source.length).toBeGreaterThan(0);
  });

  it("returns pi-coding-agent with its defaultSource", () => {
    const specs = getDefaultSources();
    const pi = specs.find((s) => s.adapter.name === "pi-coding-agent");
    expect(pi).toBeDefined();
    expect(pi?.adapter).toBe(piCodingAgentAdapter);
    expect(pi?.source).toMatch(/\.pi[/\\]agent[/\\]sessions$/);
  });

  it("only includes adapters with defaultSource set", () => {
    for (const spec of getDefaultSources()) {
      expect(spec.source).toBeTruthy();
    }
  });
});

describe("getAdapter", () => {
  it("returns adapter by name", () => {
    expect(getAdapter("claude-code")).toBe(claudeCodeAdapter);
    expect(getAdapter("pi-coding-agent")).toBe(piCodingAgentAdapter);
  });

  it("returns undefined for unknown adapter", () => {
    expect(getAdapter("nonexistent")).toBeUndefined();
  });
});

describe("detectAdapter", () => {
  it("detects claude-code from .claude/ paths", () => {
    expect(detectAdapter("/home/user/.claude/projects/foo/session.jsonl")).toBe(
      "claude-code",
    );
  });

  it("detects pi-coding-agent from .pi/agent/sessions/ paths", () => {
    expect(
      detectAdapter(
        "/home/user/.pi/agent/sessions/--project--/12345_abc.jsonl",
      ),
    ).toBe("pi-coding-agent");
  });

  it("returns undefined for unrecognized paths", () => {
    expect(detectAdapter("/tmp/random/file.jsonl")).toBeUndefined();
  });
});
