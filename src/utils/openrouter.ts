/**
 * OpenRouter API client for LLM-based title generation.
 *
 * Uses Gemini 2.5 Flash for fast, cheap title generation.
 * Gracefully handles missing API key or API failures.
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

// Approximate token limit for context (conservative estimate)
// Gemini Flash has 1M context, but we don't need anywhere near that
const MAX_CHARS = 32000; // ~8k tokens

/**
 * Truncate content with middle-cut strategy.
 * Keeps beginning and end, removes middle if over limit.
 */
function truncateMiddle(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const halfLimit = Math.floor(maxChars / 2);
  const start = content.slice(0, halfLimit);
  const end = content.slice(-halfLimit);

  return `${start}\n\n[... middle truncated ...]\n\n${end}`;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

/**
 * Generate a title for a transcript using OpenRouter.
 *
 * @param markdownContent - The full markdown transcript
 * @returns Generated title, or undefined if generation fails/skipped
 */
export async function generateTitle(
  markdownContent: string,
): Promise<string | undefined> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    // Silently skip - no API key means user doesn't want title generation
    return undefined;
  }

  const truncated = truncateMiddle(markdownContent, MAX_CHARS);

  const prompt = `Generate a concise title (5-10 words) for this AI coding session transcript. The title should capture the main task or topic discussed.

Reply with just the title, no quotes, no punctuation at the end, no explanation.

Transcript:
${truncated}`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/arcreflex/agent-transcripts",
        "X-Title": "agent-transcripts",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `Warning: OpenRouter API error (${response.status}): ${text.slice(0, 200)}`,
      );
      return undefined;
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (data.error) {
      console.error(
        `Warning: OpenRouter error: ${data.error.message || "Unknown error"}`,
      );
      return undefined;
    }

    const title = data.choices?.[0]?.message?.content?.trim();

    if (!title) {
      console.error("Warning: OpenRouter returned empty title");
      return undefined;
    }

    // Clean up: remove quotes if present, trim trailing punctuation
    return title
      .replace(/^["']|["']$/g, "")
      .replace(/[.!?]+$/, "")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Warning: OpenRouter request failed: ${message}`);
    return undefined;
  }
}
