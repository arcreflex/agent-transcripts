/**
 * Render: intermediate transcript format → HTML
 *
 * Parallel to render.ts but outputs standalone HTML with:
 * - Collapsible tool calls with input/result details
 * - Collapsible thinking sections
 * - Raw JSON toggle for each block
 * - Inline styles (no external dependencies)
 * - Terminal-inspired dark theme with amber accents
 */

import type { Transcript, Message, ToolCall } from "./types.ts";

// ============================================================================
// Styles - Terminal Chronicle Theme
// ============================================================================

const STYLES = `
/* ============================================================================
   Agent Transcripts - Terminal Chronicle Theme
   Inspired by the Claude Code TUI: dark, focused, monospace-forward
   ============================================================================ */

@import url('https://fonts.googleapis.com/css2?family=Berkeley+Mono:wght@400;500&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500&display=swap');

:root {
  /* Typography - Monospace primary, clean sans for body */
  --font-mono: 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  /* Dark theme - Terminal aesthetic */
  --bg: #0d0d0d;
  --bg-elevated: #141414;
  --bg-surface: #1a1a1a;
  --fg: #e4e4e4;
  --fg-secondary: #a3a3a3;
  --muted: #666666;
  --border: #2a2a2a;
  --border-subtle: #222222;

  /* Accent - Amber/Orange (Claude Code cursor vibe) */
  --accent: #f59e0b;
  --accent-dim: #b45309;
  --accent-glow: rgba(245, 158, 11, 0.15);

  /* Semantic colors */
  --user-accent: #3b82f6;
  --user-bg: rgba(59, 130, 246, 0.08);
  --user-border: rgba(59, 130, 246, 0.3);
  --assistant-bg: var(--bg-elevated);
  --assistant-border: var(--border);
  --system-accent: #8b5cf6;
  --system-bg: rgba(139, 92, 246, 0.06);
  --system-border: rgba(139, 92, 246, 0.25);
  --error-accent: #ef4444;
  --error-bg: rgba(239, 68, 68, 0.08);
  --error-border: rgba(239, 68, 68, 0.3);
  --tool-accent: #10b981;
  --tool-bg: rgba(16, 185, 129, 0.06);
  --tool-border: rgba(16, 185, 129, 0.2);

  /* Code blocks */
  --code-bg: #0f0f0f;
  --code-border: #252525;
  --thinking-bg: #111111;
  --thinking-border: #1f1f1f;
  --raw-bg: #0a0a0a;

  /* Links */
  --link: #60a5fa;
  --link-hover: #93c5fd;

  /* Shadows & effects */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --glow: 0 0 20px var(--accent-glow);
}

/* Light theme - Minimal, paper-like */
@media (prefers-color-scheme: light) {
  :root {
    --bg: #fafafa;
    --bg-elevated: #ffffff;
    --bg-surface: #f5f5f5;
    --fg: #171717;
    --fg-secondary: #525252;
    --muted: #a3a3a3;
    --border: #e5e5e5;
    --border-subtle: #f0f0f0;

    --accent: #d97706;
    --accent-dim: #92400e;
    --accent-glow: rgba(217, 119, 6, 0.1);

    --user-accent: #2563eb;
    --user-bg: rgba(37, 99, 235, 0.04);
    --user-border: rgba(37, 99, 235, 0.2);
    --assistant-bg: var(--bg-elevated);
    --assistant-border: var(--border);
    --system-accent: #7c3aed;
    --system-bg: rgba(124, 58, 237, 0.04);
    --system-border: rgba(124, 58, 237, 0.15);
    --error-accent: #dc2626;
    --error-bg: rgba(220, 38, 38, 0.04);
    --error-border: rgba(220, 38, 38, 0.2);
    --tool-accent: #059669;
    --tool-bg: rgba(5, 150, 105, 0.04);
    --tool-border: rgba(5, 150, 105, 0.15);

    --code-bg: #f5f5f5;
    --code-border: #e5e5e5;
    --thinking-bg: #fafafa;
    --thinking-border: #e5e5e5;
    --raw-bg: #f0f0f0;

    --link: #2563eb;
    --link-hover: #1d4ed8;

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
    --glow: none;
  }
}

*, *::before, *::after { box-sizing: border-box; }

html {
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--fg);
  line-height: 1.65;
  margin: 0;
  padding: 0;
  min-height: 100vh;
}

/* Main container */
.transcript-container {
  max-width: 54rem;
  margin: 0 auto;
  padding: 2.5rem 2rem 4rem;
  position: relative;
}

/* Subtle left border accent */
.transcript-container::before {
  content: '';
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--accent-dim) 15%,
    var(--accent) 50%,
    var(--accent-dim) 85%,
    transparent 100%
  );
  opacity: 0.6;
}

a {
  color: var(--link);
  text-decoration: none;
  transition: color 0.15s ease;
}

a:hover {
  color: var(--link-hover);
}

/* ============================================================================
   Header - Terminal prompt style
   ============================================================================ */

header {
  margin-bottom: 2.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}

header h1 {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 1.125rem;
  line-height: 1.4;
  margin: 0 0 0.75rem 0;
  color: var(--fg);
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

header h1::before {
  content: '>';
  color: var(--accent);
  font-weight: 600;
}

.meta {
  font-family: var(--font-mono);
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.7;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.meta code {
  color: var(--fg-secondary);
  background: none;
  padding: 0;
  font-size: inherit;
}

.warnings {
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-left: 3px solid var(--error-accent);
  padding: 0.875rem 1rem;
  border-radius: 0 4px 4px 0;
  margin-top: 1.25rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.warnings strong {
  color: var(--error-accent);
}

.warnings ul {
  margin: 0.5rem 0 0 0;
  padding-left: 1.25rem;
  color: var(--fg-secondary);
}

.warnings li {
  margin: 0.25rem 0;
}

/* ============================================================================
   Messages
   ============================================================================ */

main {
  position: relative;
}

.message {
  margin: 1.25rem 0;
  position: relative;
}

/* User messages - boxed with background */
.message.user {
  padding: 1rem 1.25rem;
  border-radius: 6px;
  background: var(--user-bg);
  border: 1px solid var(--user-border);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.625rem;
}

.message-label {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Role indicator dot */
.message-label::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.message.user .message-label {
  color: var(--user-accent);
}

.message.user .message-label::before {
  background: var(--user-accent);
  box-shadow: 0 0 6px var(--user-accent);
}

/* Assistant messages - no box, flows on page */
.message.assistant {
  padding: 0;
  background: transparent;
  border: none;
}

.message.assistant .message-header {
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 1rem;
}

.message.assistant .message-label {
  color: var(--accent);
}

.message.assistant .message-label::before {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}

/* System messages */
.message.system {
  padding: 1rem 1.25rem;
  border-radius: 6px;
  background: var(--system-bg);
  border: 1px solid var(--system-border);
}

.message.system .message-label {
  color: var(--system-accent);
}

.message.system .message-label::before {
  background: var(--system-accent);
}

/* Error messages */
.message.error {
  padding: 1rem 1.25rem;
  border-radius: 6px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
}

.message.error .message-label {
  color: var(--error-accent);
}

.message.error .message-label::before {
  background: var(--error-accent);
  box-shadow: 0 0 6px var(--error-accent);
}

/* ============================================================================
   Content
   ============================================================================ */

.content {
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--fg);
}

.content p {
  margin: 0 0 0.875rem 0;
}

.content p:last-child {
  margin-bottom: 0;
}

.content ul, .content ol {
  margin: 0 0 0.875rem 0;
  padding-left: 1.5rem;
}

.content li {
  margin: 0.25rem 0;
}

/* ============================================================================
   Code - Primary visual element
   ============================================================================ */

pre, code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

code {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  color: var(--fg);
}

pre {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  padding: 1rem 1.25rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.875rem 0;
  line-height: 1.5;
}

pre code {
  background: none;
  border: none;
  padding: 0;
  border-radius: 0;
}

/* ============================================================================
   Details & Thinking
   ============================================================================ */

details {
  margin: 0.625rem 0;
}

summary {
  cursor: pointer;
  user-select: none;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--muted);
  padding: 0.25rem 0;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  transition: color 0.15s ease;
}

summary:hover {
  color: var(--fg-secondary);
}

summary::marker,
summary::-webkit-details-marker {
  color: var(--accent-dim);
}

.thinking {
  border-left: 2px solid var(--accent-dim);
  padding: 0.5rem 0 0.5rem 1rem;
  margin: 0.75rem 0;
  font-size: 0.8125rem;
  color: var(--fg-secondary);
  font-style: italic;
  line-height: 1.65;
}

/* ============================================================================
   Tool Calls - Inline command style
   ============================================================================ */

.tool-calls {
  margin: 0.75rem 0;
  position: relative;
}

.tool-call {
  margin: 0.25rem 0;
}

details.tool-call {
  margin: 0.25rem 0;
}

details.tool-call > summary {
  cursor: pointer;
  list-style: none;
}

details.tool-call > summary::-webkit-details-marker {
  display: none;
}

details.tool-call > summary::marker {
  display: none;
}

.tool-call-header {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--tool-accent);
  display: inline-flex;
  align-items: baseline;
  gap: 0;
}

details.tool-call > .tool-call-header::before {
  content: '▸';
  margin-right: 0.5rem;
  font-size: 0.625rem;
  transition: transform 0.15s ease;
}

details.tool-call[open] > .tool-call-header::before {
  transform: rotate(90deg);
}

.tool-call-name {
  font-weight: 500;
}

.tool-call-summary {
  color: var(--muted);
  margin-left: 0.5rem;
}

.tool-call-error {
  color: var(--error-accent);
  margin-left: 0.5rem;
  font-weight: 500;
}

.tool-detail-content {
  margin-top: 0.375rem;
  padding: 0.75rem 1rem;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 16rem;
  overflow-y: auto;
  line-height: 1.5;
}

/* ============================================================================
   Branch Notes
   ============================================================================ */

.branch-note {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent);
  padding: 0.875rem 1rem;
  border-radius: 0 4px 4px 0;
  margin: 1.25rem 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--fg-secondary);
}

.branch-note strong {
  color: var(--fg);
}

.branch-note ul {
  margin: 0.375rem 0 0 0;
  padding-left: 1.25rem;
}

.branch-note code {
  font-size: 0.6875rem;
}

/* ============================================================================
   Raw JSON Toggle - appears on hover/focus
   ============================================================================ */

.raw-toggle {
  position: absolute;
  top: 0.2rem;
  left: -2rem;
  background: none;
  border: none;
  padding: 0.25rem;
  font-size: 0.625rem;
  color: var(--muted);
  cursor: pointer;
  font-family: var(--font-mono);
  font-weight: 500;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

/* Show on hover or when parent has focus-within */
.message:hover .raw-toggle,
.message:focus-within .raw-toggle,
.tool-calls:hover .raw-toggle,
.tool-calls:focus-within .raw-toggle,
.raw-toggle:focus {
  opacity: 1;
}

.raw-toggle:hover {
  color: var(--fg);
}

.raw-toggle.active {
  opacity: 1;
  color: var(--accent);
}

.raw-view {
  display: none;
  margin-top: 0.75rem;
  padding: 0.875rem 1rem;
  background: var(--raw-bg);
  border: 1px solid var(--code-border);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 20rem;
  overflow-y: auto;
  line-height: 1.5;
}

.raw-view.visible {
  display: block;
}

.rendered-view.hidden {
  display: none;
}

/* ============================================================================
   Scrollbar
   ============================================================================ */

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: var(--border-subtle);
}

::-webkit-scrollbar-thumb {
  background: var(--muted);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--fg-secondary);
}

/* ============================================================================
   Responsive
   ============================================================================ */

@media (max-width: 640px) {
  html {
    font-size: 14px;
  }

  .transcript-container {
    padding: 1.5rem 1rem 3rem;
  }

  .transcript-container::before {
    display: none;
  }

  header h1 {
    font-size: 1rem;
  }

  .message {
    padding: 0.875rem 1rem;
    margin: 1rem 0;
  }

  pre {
    padding: 0.75rem 1rem;
  }
}

/* ============================================================================
   Print
   ============================================================================ */

@media print {
  body {
    background: #fff;
    color: #000;
  }

  .transcript-container::before {
    display: none;
  }

  .raw-toggle {
    display: none;
  }

  .message {
    break-inside: avoid;
    box-shadow: none;
    border: 1px solid #ccc;
    background: #fff;
  }

  a {
    color: inherit;
  }
}`;

// ============================================================================
// JavaScript for raw toggle
// ============================================================================

const SCRIPT = `
(function() {
  document.querySelectorAll('.raw-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const block = btn.closest('.message, .tool-calls');
      const rawView = block.querySelector('.raw-view');
      const renderedView = block.querySelector('.rendered-view');

      if (rawView.classList.contains('visible')) {
        rawView.classList.remove('visible');
        renderedView.classList.remove('hidden');
        btn.classList.remove('active');
      } else {
        rawView.classList.add('visible');
        renderedView.classList.add('hidden');
        btn.classList.add('active');
      }
    });
  });
})();
`;

// ============================================================================
// HTML Utilities
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format JSON for display with indentation.
 */
function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Convert markdown-ish content to HTML.
 * Handles: code blocks, inline code, basic formatting.
 */
function contentToHtml(content: string): string {
  let html = escapeHtml(content);

  // Code blocks: ```lang\n...\n```
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang, code) =>
      `<pre><code class="language-${lang}">${code.trim()}</code></pre>`,
  );

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert newlines to <br> for non-code content
  // Split by pre blocks, process non-code parts
  const parts = html.split(/(<pre>[\s\S]*?<\/pre>)/);
  html = parts
    .map((part) => {
      if (part.startsWith("<pre>")) return part;
      // Preserve paragraph breaks (double newline)
      return part
        .split(/\n\n+/)
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("");
    })
    .join("");

  return html;
}

/**
 * Truncate text for display, keeping it readable.
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

// ============================================================================
// Message Rendering
// ============================================================================

function renderToolCall(call: ToolCall): string {
  const hasResult = call.result && call.result.length > 0;

  let headerContent = `<span class="tool-call-name">${escapeHtml(call.name)}</span>`;
  if (call.summary) {
    headerContent += `<span class="tool-call-summary">${escapeHtml(call.summary)}</span>`;
  }
  if (call.error) {
    headerContent += `<span class="tool-call-error">${escapeHtml(call.error)}</span>`;
  }

  if (hasResult) {
    // Wrap in details/summary for expandable result
    return `<details class="tool-call">
  <summary class="tool-call-header">${headerContent}</summary>
  <div class="tool-detail-content">${escapeHtml(call.result!)}</div>
</details>`;
  } else {
    // No result, just show the header
    return `<div class="tool-call">
  <div class="tool-call-header">${headerContent}</div>
</div>`;
  }
}

function renderRawToggle(): string {
  return `<button class="raw-toggle" title="Toggle raw JSON">&lt;/&gt;</button>`;
}

interface RenderContext {
  showAssistantHeader: boolean;
}

function renderMessage(msg: Message, ctx: RenderContext): string {
  const rawJson = msg.rawJson
    ? escapeHtml(formatJson(JSON.parse(msg.rawJson)))
    : "";

  switch (msg.type) {
    case "user":
      return `
<div class="message user">
  <div class="message-header">
    <span class="message-label">User</span>
  </div>
  ${msg.rawJson ? renderRawToggle() : ""}
  <div class="rendered-view">
    <div class="content">${contentToHtml(msg.content)}</div>
  </div>
  ${msg.rawJson ? `<div class="raw-view">${rawJson}</div>` : ""}
</div>`;

    case "assistant": {
      let rendered = "";

      if (msg.thinking) {
        rendered += `
  <details>
    <summary>thinking...</summary>
    <div class="thinking">${contentToHtml(msg.thinking)}</div>
  </details>`;
      }

      if (msg.content.trim()) {
        rendered += `
  <div class="content">${contentToHtml(msg.content)}</div>`;
      }

      const header = ctx.showAssistantHeader
        ? `
  <div class="message-header">
    <span class="message-label">Assistant</span>
  </div>`
        : "";

      return `
<div class="message assistant">${header}
  ${msg.rawJson ? renderRawToggle() : ""}
  <div class="rendered-view">${rendered}
  </div>
  ${msg.rawJson ? `<div class="raw-view">${rawJson}</div>` : ""}
</div>`;
    }

    case "system":
      return `
<div class="message system">
  <div class="message-header">
    <span class="message-label">System</span>
  </div>
  ${msg.rawJson ? renderRawToggle() : ""}
  <div class="rendered-view">
    <div class="content"><pre>${escapeHtml(msg.content)}</pre></div>
  </div>
  ${msg.rawJson ? `<div class="raw-view">${rawJson}</div>` : ""}
</div>`;

    case "tool_calls": {
      return `
<div class="tool-calls">
  ${msg.rawJson ? renderRawToggle() : ""}
  <div class="rendered-view">
    ${msg.calls.map(renderToolCall).join("\n    ")}
  </div>
  ${msg.rawJson ? `<div class="raw-view">${rawJson}</div>` : ""}
</div>`;
    }

    case "error":
      return `
<div class="message error">
  <div class="message-header">
    <span class="message-label">Error</span>
  </div>
  ${msg.rawJson ? renderRawToggle() : ""}
  <div class="rendered-view">
    <div class="content"><pre>${escapeHtml(msg.content)}</pre></div>
  </div>
  ${msg.rawJson ? `<div class="raw-view">${rawJson}</div>` : ""}
</div>`;

    default:
      return "";
  }
}

// ============================================================================
// Tree/Branch Logic (same as render.ts)
// ============================================================================

function buildTree(messages: Message[]): {
  bySourceRef: Map<string, Message[]>;
  children: Map<string, Set<string>>;
  parents: Map<string, string>;
  roots: string[];
} {
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

function findLatestLeaf(
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

function tracePath(target: string, parents: Map<string, string>): string[] {
  const path: string[] = [];
  let current: string | undefined = target;

  while (current) {
    path.unshift(current);
    current = parents.get(current);
  }

  return path;
}

function getFirstLine(msg: Message): string {
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
// Main Renderer
// ============================================================================

export interface RenderHtmlOptions {
  head?: string; // render branch ending at this message ID
  title?: string; // page title (used in index linking)
}

/**
 * Render transcript to standalone HTML.
 */
export function renderTranscriptHtml(
  transcript: Transcript,
  options: RenderHtmlOptions = {},
): string {
  const { head, title } = options;

  const pageTitle = title || `Transcript - ${transcript.source.file}`;

  // Build header section
  let headerHtml = `
<header>
  <h1>${escapeHtml(pageTitle)}</h1>
  <div class="meta">
    <span>source: <code>${escapeHtml(transcript.source.file)}</code></span>
    <span>adapter: ${escapeHtml(transcript.source.adapter)}</span>
  </div>`;

  if (transcript.metadata.warnings.length > 0) {
    headerHtml += `
  <div class="warnings">
    <strong>! warnings</strong>
    <ul>
      ${transcript.metadata.warnings.map((w) => `<li>${escapeHtml(w.type)}: ${escapeHtml(w.detail)}</li>`).join("\n      ")}
    </ul>
  </div>`;
  }

  headerHtml += "\n</header>";

  // Build messages section
  let messagesHtml = "";

  if (transcript.messages.length === 0) {
    messagesHtml = "<p><em>No messages in this transcript.</em></p>";
  } else {
    const { bySourceRef, children, parents } = buildTree(transcript.messages);

    let target: string | undefined;
    if (head) {
      if (!bySourceRef.has(head)) {
        messagesHtml = `<p class="error">Message ID <code>${escapeHtml(head)}</code> not found</p>`;
      } else {
        target = head;
      }
    } else {
      target = findLatestLeaf(bySourceRef, children);
    }

    if (target) {
      const path = tracePath(target, parents);
      const pathSet = new Set(path);
      let inAssistantTurn = false;

      for (const sourceRef of path) {
        const msgs = bySourceRef.get(sourceRef);
        if (!msgs) continue;

        for (const msg of msgs) {
          // Track when we enter/exit assistant turns
          const isAssistantContent =
            msg.type === "assistant" || msg.type === "tool_calls";

          // Show header only at the START of an assistant turn (after user)
          const showAssistantHeader = isAssistantContent && !inAssistantTurn;

          messagesHtml += renderMessage(msg, { showAssistantHeader });

          // Update turn state
          if (msg.type === "user") {
            inAssistantTurn = false;
          } else if (isAssistantContent) {
            inAssistantTurn = true;
          }
        }

        // Branch notes
        if (!head) {
          const childSet = children.get(sourceRef);
          if (childSet && childSet.size > 1) {
            const otherBranches = [...childSet].filter((c) => !pathSet.has(c));
            if (otherBranches.length > 0) {
              messagesHtml += `
<div class="branch-note">
  <strong>Other branches:</strong>
  <ul>
    ${otherBranches
      .map((branchRef) => {
        const branchMsgs = bySourceRef.get(branchRef);
        if (branchMsgs && branchMsgs.length > 0) {
          const firstLine = getFirstLine(branchMsgs[0]);
          return `<li><code>${escapeHtml(branchRef)}</code> "${escapeHtml(firstLine)}"</li>`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n    ")}
  </ul>
</div>`;
            }
          }
        }
      }
    }
  }

  // Assemble full HTML
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="transcript-container">
    ${headerHtml}
    <main>
      ${messagesHtml}
    </main>
  </div>
  <script>${SCRIPT}</script>
</body>
</html>`;
}
