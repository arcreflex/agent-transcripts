/**
 * Output file naming utilities.
 *
 * Generates descriptive filenames for transcripts:
 * - With OpenRouter API key: yyyy-mm-dd-{llm-generated-slug}.{ext}
 * - Without: yyyy-mm-dd-{input-filename-prefix}.{ext}
 */

import type { Transcript, UserMessage } from "../types.ts";
import { basename } from "path";

export interface NamingOptions {
  apiKey?: string; // OpenRouter API key
  model?: string; // Default: google/gemini-2.0-flash-001
}

const DEFAULT_MODEL = "google/gemini-2.0-flash-001";
const SLUG_MAX_LENGTH = 40;

/**
 * Extract date from transcript's first message timestamp.
 */
function extractDate(transcript: Transcript): string {
  const firstMessage = transcript.messages[0];
  if (firstMessage?.timestamp) {
    const date = new Date(firstMessage.timestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10); // yyyy-mm-dd
    }
  }
  // Fallback to current date
  return new Date().toISOString().slice(0, 10);
}

/**
 * Extract context from transcript for LLM summarization.
 * Uses first few user messages, truncated.
 */
function extractContext(transcript: Transcript): string {
  const userMessages = transcript.messages.filter(
    (m): m is UserMessage => m.type === "user",
  );

  const chunks: string[] = [];
  let totalLength = 0;
  const maxLength = 500;

  for (const msg of userMessages.slice(0, 3)) {
    const content = msg.content.slice(0, 200);
    if (totalLength + content.length > maxLength) break;
    chunks.push(content);
    totalLength += content.length;
  }

  return chunks.join("\n\n");
}

/**
 * Sanitize a string into a valid URL slug.
 */
function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // remove special chars
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    .slice(0, SLUG_MAX_LENGTH);
}

/**
 * Generate slug via OpenRouter API.
 */
async function generateSlugViaLLM(
  context: string,
  options: NamingOptions,
): Promise<string | null> {
  const { apiKey, model = DEFAULT_MODEL } = options;
  if (!apiKey || !context.trim()) return null;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: `Generate a 2-4 word URL slug (lowercase, hyphenated) summarizing this conversation topic. Reply with ONLY the slug, nothing else.\n\n${context}`,
            },
          ],
          max_tokens: 20,
        }),
      },
    );

    if (!response.ok) {
      console.error(
        `OpenRouter API error: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) return null;

    const slug = sanitizeSlug(content);
    return slug || null;
  } catch (error) {
    console.error(
      `OpenRouter API call failed: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

/**
 * Generate fallback slug from input filename.
 */
function generateFallbackSlug(inputPath: string): string {
  return extractFileId(inputPath, 8) || "transcript";
}

/**
 * Extract a short identifier from the input filename.
 * Used as a suffix for traceability back to source.
 */
function extractFileId(inputPath: string, length = 6): string {
  if (inputPath === "<stdin>") {
    return "";
  }

  const name = basename(inputPath);
  const base = name.replace(/\.jsonl?$/, "");
  // Take first N chars, sanitize, and clean up any trailing hyphens
  return sanitizeSlug(base.slice(0, length)).replace(/-+$/, "");
}

/**
 * Generate output base name for a transcript.
 * Returns string like "2024-01-15-implement-auth-flow-abc123"
 */
export async function generateOutputName(
  transcript: Transcript,
  inputPath: string,
  options: NamingOptions = {},
): Promise<string> {
  const date = extractDate(transcript);
  const fileId = extractFileId(inputPath);

  // Try LLM-generated slug if API key available
  if (options.apiKey) {
    const context = extractContext(transcript);
    const slug = await generateSlugViaLLM(context, options);
    if (slug) {
      return fileId ? `${date}-${slug}-${fileId}` : `${date}-${slug}`;
    }
  }

  // Fallback to input filename prefix (no need for fileId suffix, it's already the slug)
  const slug = generateFallbackSlug(inputPath);
  return `${date}-${slug}`;
}
