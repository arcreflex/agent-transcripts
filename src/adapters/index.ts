/**
 * Adapter registry with path-based detection.
 */

import type { Adapter, SourceSpec } from "../types.ts";
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

export function getAdapter(name: string): Adapter | undefined {
  return adapters[name];
}

export function listAdapters(): string[] {
  return Object.keys(adapters);
}

/**
 * Get default source specs from adapters that define a defaultSource.
 */
export function getDefaultSources(): SourceSpec[] {
  return Object.values(adapters)
    .filter((a): a is Adapter & { defaultSource: string } => !!a.defaultSource)
    .map((a) => ({ adapter: a, source: a.defaultSource }));
}
