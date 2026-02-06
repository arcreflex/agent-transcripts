/**
 * Tree/branch navigation utilities for transcript messages.
 */

import type { Transcript, Message } from "../types.ts";

export interface MessageTree {
  bySourceRef: Map<string, Message[]>;
  children: Map<string, Set<string>>;
  parents: Map<string, string>;
  roots: string[];
}

/**
 * Build tree structure from messages.
 * Returns maps for navigation and the messages grouped by sourceRef.
 */
export function buildTree(messages: Message[]): MessageTree {
  const bySourceRef = new Map<string, Message[]>();
  for (const msg of messages) {
    const existing = bySourceRef.get(msg.sourceRef) || [];
    existing.push(msg);
    bySourceRef.set(msg.sourceRef, existing);
  }

  const children = new Map<string, Set<string>>();
  const parents = new Map<string, string>();

  for (const msg of messages) {
    if (msg.parentMessageRef && bySourceRef.has(msg.parentMessageRef)) {
      parents.set(msg.sourceRef, msg.parentMessageRef);
      const existing = children.get(msg.parentMessageRef) || new Set();
      existing.add(msg.sourceRef);
      children.set(msg.parentMessageRef, existing);
    }
  }

  const roots: string[] = [];
  for (const sourceRef of bySourceRef.keys()) {
    if (!parents.has(sourceRef)) {
      roots.push(sourceRef);
    }
  }

  return { bySourceRef, children, parents, roots };
}

/**
 * Find the latest leaf in the tree (for primary branch).
 */
export function findLatestLeaf(
  bySourceRef: Map<string, Message[]>,
  children: Map<string, Set<string>>,
): string | undefined {
  let latestLeaf: string | undefined;
  let latestTime = 0;

  for (const sourceRef of bySourceRef.keys()) {
    const childSet = children.get(sourceRef);
    if (!childSet || childSet.size === 0) {
      const msgs = bySourceRef.get(sourceRef);
      if (msgs && msgs.length > 0) {
        const time = new Date(msgs[0].timestamp).getTime();
        if (time > latestTime) {
          latestTime = time;
          latestLeaf = sourceRef;
        }
      }
    }
  }

  return latestLeaf;
}

/**
 * Trace path from root to target.
 */
export function tracePath(
  target: string,
  parents: Map<string, string>,
): string[] {
  const path: string[] = [];
  let current: string | undefined = target;

  while (current) {
    path.unshift(current);
    current = parents.get(current);
  }

  return path;
}

/**
 * Get first line of message content for branch reference display.
 */
export function getFirstLine(msg: Message): string {
  let text: string;
  switch (msg.type) {
    case "user":
    case "assistant":
    case "system":
    case "error":
      text = msg.content;
      break;
    case "tool_calls":
      text = msg.calls.map((c) => c.name).join(", ");
      break;
    default:
      text = "";
  }
  const firstLine = text.split("\n")[0].trim();
  const maxLen = 60;
  return firstLine.length > maxLen
    ? firstLine.slice(0, maxLen) + "..."
    : firstLine;
}

// ============================================================================
// Tree walk: yields events as it walks the primary branch of a transcript.
// ============================================================================

export type TreeEvent =
  | { type: "messages"; messages: Message[] }
  | { type: "branch_note"; branches: BranchInfo[] }
  | { type: "head_not_found"; head: string }
  | { type: "empty" };

export interface BranchInfo {
  sourceRef: string;
  firstLine: string;
}

export interface WalkOptions {
  head?: string;
}

/**
 * Walk the primary branch of a transcript, yielding render events.
 * Handles tree construction, target resolution, path tracing, and branch detection.
 */
export function* walkTranscriptTree(
  transcript: Transcript,
  options: WalkOptions = {},
): Generator<TreeEvent> {
  if (transcript.messages.length === 0) {
    yield { type: "empty" };
    return;
  }

  const { head } = options;
  const { bySourceRef, children, parents } = buildTree(transcript.messages);

  let target: string | undefined;
  if (head) {
    if (!bySourceRef.has(head)) {
      yield { type: "head_not_found", head };
      return;
    }
    target = head;
  } else {
    target = findLatestLeaf(bySourceRef, children);
  }

  if (!target) {
    // Fallback: yield all messages in order
    yield { type: "messages", messages: transcript.messages };
    return;
  }

  const path = tracePath(target, parents);
  const pathSet = new Set(path);

  for (const sourceRef of path) {
    const msgs = bySourceRef.get(sourceRef);
    if (!msgs) continue;

    yield { type: "messages", messages: msgs };

    // Branch notes (only when not using explicit head)
    if (!head) {
      const childSet = children.get(sourceRef);
      if (childSet && childSet.size > 1) {
        const branches: BranchInfo[] = [];
        for (const childRef of childSet) {
          if (pathSet.has(childRef)) continue;
          const branchMsgs = bySourceRef.get(childRef);
          if (branchMsgs && branchMsgs.length > 0) {
            branches.push({
              sourceRef: childRef,
              firstLine: getFirstLine(branchMsgs[0]),
            });
          }
        }
        if (branches.length > 0) {
          yield { type: "branch_note", branches };
        }
      }
    }
  }
}
