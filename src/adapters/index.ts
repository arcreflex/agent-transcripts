/**
 * Adapter registry with path-based detection.
 */

import type { Adapter } from "../types.ts";
import { claudeCodeAdapter } from "./claude-code.ts";

const adapters: Record<string, Adapter> = {
  "claude-code": claudeCodeAdapter,
};

/**
 * Detection rules: path pattern → adapter name
 */
const detectionRules: Array<{ pattern: RegExp; adapter: string }> = [
  // Match .claude/ or /claude/ in path
  { pattern: /[./]claude[/\\]/, adapter: "claude-code" },
];

/**
 * Detect adapter from file path.
 * Returns adapter name if detected, undefined if not.
 */
export function detectAdapter(filePath: string): string | undefined {
  for (const rule of detectionRules) {
    if (rule.pattern.test(filePath)) {
      return rule.adapter;
    }
  }
  return undefined;
}

/**
 * Get adapter by name.
 */
export function getAdapter(name: string): Adapter | undefined {
  return adapters[name];
}

/**
 * List available adapter names.
 */
export function listAdapters(): string[] {
  return Object.keys(adapters);
}
