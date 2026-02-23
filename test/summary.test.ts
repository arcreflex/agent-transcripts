import { describe, expect, it } from "bun:test";
import { extractToolSummary } from "../src/utils/summary.ts";

describe("extractToolSummary", () => {
  describe("Read", () => {
    it("returns file_path", () => {
      expect(extractToolSummary("Read", { file_path: "/foo/bar.ts" })).toBe(
        "/foo/bar.ts",
      );
    });

    it("returns empty for missing file_path", () => {
      expect(extractToolSummary("Read", {})).toBe("");
    });

    it("returns path (pi-coding-agent style)", () => {
      expect(extractToolSummary("Read", { path: "src/index.ts" })).toBe(
        "src/index.ts",
      );
    });
  });

  describe("Write", () => {
    it("returns file_path", () => {
      expect(extractToolSummary("Write", { file_path: "/out.txt" })).toBe(
        "/out.txt",
      );
    });
  });

  describe("Edit", () => {
    it("returns file_path", () => {
      expect(extractToolSummary("Edit", { file_path: "/src/index.ts" })).toBe(
        "/src/index.ts",
      );
    });
  });

  describe("Bash", () => {
    it("prefers description over command", () => {
      expect(
        extractToolSummary("Bash", {
          description: "Run tests",
          command: "bun test",
        }),
      ).toBe("Run tests");
    });

    it("falls back to truncated command", () => {
      const longCmd = "a".repeat(100);
      const result = extractToolSummary("Bash", { command: longCmd });
      expect(result.length).toBe(60);
      expect(result.endsWith("...")).toBe(true);
    });

    it("returns empty for no description or command", () => {
      expect(extractToolSummary("Bash", {})).toBe("");
    });
  });

  describe("Grep", () => {
    it("returns pattern with path", () => {
      expect(
        extractToolSummary("Grep", { pattern: "TODO", path: "/src" }),
      ).toBe("TODO in /src");
    });

    it("returns pattern alone without path", () => {
      expect(extractToolSummary("Grep", { pattern: "TODO" })).toBe("TODO");
    });

    it("truncates long patterns", () => {
      const long = "x".repeat(100);
      const result = extractToolSummary("Grep", { pattern: long });
      expect(result.length).toBe(80);
      expect(result.endsWith("...")).toBe(true);
    });
  });

  describe("Glob", () => {
    it("returns pattern", () => {
      expect(extractToolSummary("Glob", { pattern: "**/*.ts" })).toBe(
        "**/*.ts",
      );
    });
  });

  describe("WebFetch", () => {
    it("returns url", () => {
      expect(
        extractToolSummary("WebFetch", { url: "https://example.com" }),
      ).toBe("https://example.com");
    });
  });

  describe("WebSearch", () => {
    it("returns query", () => {
      expect(
        extractToolSummary("WebSearch", { query: "bun test runner" }),
      ).toBe("bun test runner");
    });
  });

  describe("Task", () => {
    it("prefers description", () => {
      expect(
        extractToolSummary("Task", { description: "Research this topic" }),
      ).toBe("Research this topic");
    });

    it("falls back to prompt", () => {
      expect(extractToolSummary("Task", { prompt: "Do the thing" })).toBe(
        "Do the thing",
      );
    });

    it("truncates long descriptions", () => {
      const long = "y".repeat(100);
      const result = extractToolSummary("Task", { description: long });
      expect(result.length).toBe(60);
      expect(result.endsWith("...")).toBe(true);
    });
  });

  describe("TodoWrite", () => {
    it("returns fixed string", () => {
      expect(extractToolSummary("TodoWrite", {})).toBe("update todos");
    });
  });

  describe("AskUserQuestion", () => {
    it("returns fixed string", () => {
      expect(extractToolSummary("AskUserQuestion", {})).toBe("ask user");
    });
  });

  describe("NotebookEdit", () => {
    it("returns notebook_path", () => {
      expect(
        extractToolSummary("NotebookEdit", { notebook_path: "/nb.ipynb" }),
      ).toBe("/nb.ipynb");
    });
  });

  describe("unknown tool", () => {
    it("returns empty string", () => {
      expect(extractToolSummary("SomeUnknownTool", { x: 1 })).toBe("");
    });
  });
});
