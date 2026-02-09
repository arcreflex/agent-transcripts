import { describe, expect, it } from "bun:test";
import { getDefaultSources, getAdapter } from "../src/adapters/index.ts";
import { claudeCodeAdapter } from "../src/adapters/claude-code.ts";

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

  it("only includes adapters with defaultSource set", () => {
    for (const spec of getDefaultSources()) {
      expect(spec.source).toBeTruthy();
    }
  });
});

describe("getAdapter", () => {
  it("returns adapter by name", () => {
    expect(getAdapter("claude-code")).toBe(claudeCodeAdapter);
  });

  it("returns undefined for unknown adapter", () => {
    expect(getAdapter("nonexistent")).toBeUndefined();
  });
});
