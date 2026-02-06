import { describe, expect, it } from "bun:test";
import {
  extractSessionId,
  formatDateTimePrefix,
  generateOutputName,
} from "../src/utils/naming.ts";
import type { Transcript } from "../src/types.ts";

describe("extractSessionId", () => {
  it("strips .jsonl extension", () => {
    expect(extractSessionId("/path/to/abc-123.jsonl")).toBe("abc-123");
  });

  it("strips .json extension", () => {
    expect(extractSessionId("/path/to/session.json")).toBe("session");
  });

  it("returns 'stdin' for <stdin>", () => {
    expect(extractSessionId("<stdin>")).toBe("stdin");
  });

  it("handles bare filename", () => {
    expect(extractSessionId("my-session.jsonl")).toBe("my-session");
  });

  it("handles filename with no extension", () => {
    expect(extractSessionId("/path/to/no-extension")).toBe("no-extension");
  });

  it("handles deeply nested paths", () => {
    expect(
      extractSessionId(
        "/home/user/.claude/projects/foo/sessions/uuid-here.jsonl",
      ),
    ).toBe("uuid-here");
  });
});

describe("formatDateTimePrefix", () => {
  it("formats a valid ISO timestamp", () => {
    // Use a fixed timestamp and check the format pattern
    const result = formatDateTimePrefix("2024-01-15T14:23:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
  });

  it("falls back to current date for invalid timestamp", () => {
    const result = formatDateTimePrefix("not-a-date");
    // Should still produce a valid format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
  });

  it("falls back to current date for empty string", () => {
    const result = formatDateTimePrefix("");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
  });
});

describe("generateOutputName", () => {
  it("combines datetime prefix and session id", () => {
    const transcript: Transcript = {
      source: { file: "test.jsonl", adapter: "claude-code" },
      metadata: {
        warnings: [],
        messageCount: 1,
        startTime: "2024-01-15T14:23:00Z",
        endTime: "2024-01-15T14:30:00Z",
      },
      messages: [
        {
          type: "user",
          sourceRef: "msg-1",
          timestamp: "2024-01-15T14:23:00Z",
          content: "hello",
        },
      ],
    };

    const result = generateOutputName(transcript, "/path/to/my-session.jsonl");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-my-session$/);
  });

  it("handles transcript with no messages", () => {
    const transcript: Transcript = {
      source: { file: "test.jsonl", adapter: "claude-code" },
      metadata: {
        warnings: [],
        messageCount: 0,
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-01T00:00:00Z",
      },
      messages: [],
    };

    const result = generateOutputName(transcript, "empty.jsonl");
    // No messages → empty timestamp → falls back to current date
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-empty$/);
  });
});
