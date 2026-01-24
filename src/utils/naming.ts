/**
 * Output file naming utilities.
 *
 * Generates deterministic filenames: {datetime}-{sessionId}.md
 */

import type { Transcript } from "../types.ts";
import { basename } from "path";

/**
 * Extract date and time from transcript's first message timestamp.
 * Returns format: yyyy-mm-dd-hhmm (24-hour, local time)
 */
function extractDateTime(transcript: Transcript): string {
  const firstMessage = transcript.messages[0];
  const date = firstMessage?.timestamp
    ? new Date(firstMessage.timestamp)
    : new Date();

  if (isNaN(date.getTime())) {
    return formatDateTime(new Date());
  }
  return formatDateTime(date);
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

/**
 * Extract session ID from the input filename.
 * Returns the full session ID (filename without extension) for traceability.
 */
export function extractSessionId(inputPath: string): string {
  if (inputPath === "<stdin>") {
    return "stdin";
  }

  const name = basename(inputPath);
  // Remove .jsonl or .json extension
  return name.replace(/\.jsonl?$/, "");
}

/**
 * Generate output base name for a transcript.
 * Returns format: "2024-01-15-1423-{sessionId}"
 */
export function generateOutputName(
  transcript: Transcript,
  inputPath: string,
): string {
  const dateTime = extractDateTime(transcript);
  const sessionId = extractSessionId(inputPath);
  return `${dateTime}-${sessionId}`;
}
