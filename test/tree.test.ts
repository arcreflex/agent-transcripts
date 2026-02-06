import { describe, expect, it } from "bun:test";
import {
  buildTree,
  findLatestLeaf,
  tracePath,
  getFirstLine,
} from "../src/utils/tree.ts";
import type { Message, UserMessage, AssistantMessage } from "../src/types.ts";

function userMsg(
  sourceRef: string,
  timestamp: string,
  content: string,
  parentMessageRef?: string,
): UserMessage {
  return { type: "user", sourceRef, timestamp, content, parentMessageRef };
}

function assistantMsg(
  sourceRef: string,
  timestamp: string,
  content: string,
  parentMessageRef?: string,
): AssistantMessage {
  return { type: "assistant", sourceRef, timestamp, content, parentMessageRef };
}

describe("buildTree", () => {
  it("builds a linear chain", () => {
    const msgs: Message[] = [
      userMsg("a", "2024-01-01T00:00:00Z", "hi"),
      assistantMsg("b", "2024-01-01T00:01:00Z", "hello", "a"),
      userMsg("c", "2024-01-01T00:02:00Z", "bye", "b"),
    ];

    const tree = buildTree(msgs);

    expect(tree.roots).toEqual(["a"]);
    expect(tree.parents.get("b")).toBe("a");
    expect(tree.parents.get("c")).toBe("b");
    expect([...(tree.children.get("a") ?? [])]).toEqual(["b"]);
    expect([...(tree.children.get("b") ?? [])]).toEqual(["c"]);
    expect(tree.children.has("c")).toBe(false);
  });

  it("builds a tree with a branch point", () => {
    const msgs: Message[] = [
      userMsg("a", "2024-01-01T00:00:00Z", "root"),
      assistantMsg("b", "2024-01-01T00:01:00Z", "reply", "a"),
      userMsg("c", "2024-01-01T00:02:00Z", "branch 1", "b"),
      userMsg("d", "2024-01-01T00:03:00Z", "branch 2", "b"),
    ];

    const tree = buildTree(msgs);

    expect(tree.roots).toEqual(["a"]);
    const bChildren = [...(tree.children.get("b") ?? [])];
    expect(bChildren.sort()).toEqual(["c", "d"]);
    expect(tree.parents.get("c")).toBe("b");
    expect(tree.parents.get("d")).toBe("b");
  });

  it("handles empty messages", () => {
    const tree = buildTree([]);

    expect(tree.roots).toEqual([]);
    expect(tree.bySourceRef.size).toBe(0);
    expect(tree.children.size).toBe(0);
    expect(tree.parents.size).toBe(0);
  });

  it("handles a single message", () => {
    const msgs: Message[] = [userMsg("only", "2024-01-01T00:00:00Z", "alone")];

    const tree = buildTree(msgs);

    expect(tree.roots).toEqual(["only"]);
    expect(tree.parents.size).toBe(0);
    expect(tree.children.size).toBe(0);
    expect(tree.bySourceRef.get("only")).toEqual([msgs[0]]);
  });

  it("ignores parentMessageRef pointing to nonexistent message", () => {
    const msgs: Message[] = [
      userMsg("a", "2024-01-01T00:00:00Z", "hi", "nonexistent"),
    ];

    const tree = buildTree(msgs);

    // "a" has an invalid parent, so it becomes a root
    expect(tree.roots).toEqual(["a"]);
    expect(tree.parents.size).toBe(0);
  });

  it("groups multiple messages with same sourceRef", () => {
    const msgs: Message[] = [
      assistantMsg("x", "2024-01-01T00:00:00Z", "text part"),
      {
        type: "tool_calls",
        sourceRef: "x",
        timestamp: "2024-01-01T00:00:00Z",
        calls: [{ name: "Read", summary: "/foo" }],
      },
    ];

    const tree = buildTree(msgs);

    expect(tree.bySourceRef.get("x")?.length).toBe(2);
    expect(tree.roots).toEqual(["x"]);
  });
});

describe("findLatestLeaf", () => {
  it("finds the leaf with the latest timestamp", () => {
    const msgs: Message[] = [
      userMsg("a", "2024-01-01T00:00:00Z", "root"),
      assistantMsg("b", "2024-01-01T00:01:00Z", "reply", "a"),
      userMsg("c", "2024-01-01T00:02:00Z", "early branch", "b"),
      userMsg("d", "2024-01-01T00:05:00Z", "late branch", "b"),
    ];

    const tree = buildTree(msgs);
    const leaf = findLatestLeaf(tree.bySourceRef, tree.children);

    expect(leaf).toBe("d");
  });

  it("returns undefined for empty maps", () => {
    const leaf = findLatestLeaf(new Map(), new Map());
    expect(leaf).toBeUndefined();
  });

  it("returns the single node when there is only one", () => {
    const msgs: Message[] = [userMsg("only", "2024-01-01T00:00:00Z", "alone")];

    const tree = buildTree(msgs);
    const leaf = findLatestLeaf(tree.bySourceRef, tree.children);

    expect(leaf).toBe("only");
  });

  it("skips non-leaf nodes", () => {
    const msgs: Message[] = [
      userMsg("a", "2024-01-01T10:00:00Z", "root"),
      // "a" has a later timestamp, but it's not a leaf
      assistantMsg("b", "2024-01-01T00:01:00Z", "reply", "a"),
    ];

    const tree = buildTree(msgs);
    const leaf = findLatestLeaf(tree.bySourceRef, tree.children);

    expect(leaf).toBe("b");
  });
});

describe("tracePath", () => {
  it("traces a path from root to target", () => {
    const parents = new Map([
      ["c", "b"],
      ["b", "a"],
    ]);

    expect(tracePath("c", parents)).toEqual(["a", "b", "c"]);
  });

  it("returns single element for a root", () => {
    expect(tracePath("root", new Map())).toEqual(["root"]);
  });

  it("handles deep chains", () => {
    const parents = new Map([
      ["e", "d"],
      ["d", "c"],
      ["c", "b"],
      ["b", "a"],
    ]);

    expect(tracePath("e", parents)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("getFirstLine", () => {
  it("returns first line of user message", () => {
    const msg = userMsg("x", "2024-01-01T00:00:00Z", "first\nsecond\nthird");
    expect(getFirstLine(msg)).toBe("first");
  });

  it("truncates long lines", () => {
    const long = "a".repeat(100);
    const msg = userMsg("x", "2024-01-01T00:00:00Z", long);
    expect(getFirstLine(msg).length).toBe(63); // 60 + "..."
    expect(getFirstLine(msg).endsWith("...")).toBe(true);
  });

  it("returns tool names for tool_calls", () => {
    const msg: Message = {
      type: "tool_calls",
      sourceRef: "x",
      timestamp: "2024-01-01T00:00:00Z",
      calls: [
        { name: "Read", summary: "/foo" },
        { name: "Write", summary: "/bar" },
      ],
    };
    expect(getFirstLine(msg)).toBe("Read, Write");
  });

  it("returns empty string for unknown type content", () => {
    const msg = assistantMsg("x", "2024-01-01T00:00:00Z", "");
    expect(getFirstLine(msg)).toBe("");
  });

  it("trims whitespace from first line", () => {
    const msg = userMsg("x", "2024-01-01T00:00:00Z", "  padded  \nsecond");
    expect(getFirstLine(msg)).toBe("padded");
  });
});
