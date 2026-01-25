/**
 * Render index.html for browsing transcripts.
 *
 * Generates a standalone index page with:
 * - Session list with titles and dates
 * - Client-side filtering
 * - Data embedded inline (works with file://)
 */

import type { TranscriptsIndex } from "./utils/provenance.ts";

// ============================================================================
// Styles - Terminal Chronicle Theme (Index)
// ============================================================================

const INDEX_STYLES = `
/* ============================================================================
   Agent Transcripts Index - Terminal Chronicle Theme
   ============================================================================ */

@import url('https://fonts.googleapis.com/css2?family=Berkeley+Mono:wght@400;500&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500&display=swap');

:root {
  /* Typography */
  --font-mono: 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  /* Dark theme */
  --bg: #0d0d0d;
  --bg-elevated: #141414;
  --bg-surface: #1a1a1a;
  --fg: #e4e4e4;
  --fg-secondary: #a3a3a3;
  --muted: #666666;
  --border: #2a2a2a;
  --border-subtle: #222222;

  /* Accent */
  --accent: #f59e0b;
  --accent-dim: #b45309;
  --accent-glow: rgba(245, 158, 11, 0.15);

  /* Cards */
  --card-bg: var(--bg-elevated);
  --card-hover: var(--bg-surface);
  --card-border: var(--border);
  --card-border-hover: #3a3a3a;

  /* Links */
  --link: #60a5fa;
  --link-hover: #93c5fd;

  /* Input */
  --input-bg: var(--bg-elevated);
  --input-border: var(--border);
  --input-focus: var(--accent);

  /* Effects */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
}

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

    --card-bg: var(--bg-elevated);
    --card-hover: var(--bg-surface);
    --card-border: var(--border);
    --card-border-hover: #d4d4d4;

    --link: #2563eb;
    --link-hover: #1d4ed8;

    --input-bg: var(--bg-elevated);
    --input-border: var(--border);
    --input-focus: var(--accent);

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
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
  line-height: 1.6;
  margin: 0;
  padding: 0;
  min-height: 100vh;
}

.index-container {
  max-width: 54rem;
  margin: 0 auto;
  padding: 2.5rem 2rem 4rem;
  position: relative;
}

/* Subtle accent bar */
.index-container::before {
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
   Header
   ============================================================================ */

header {
  margin-bottom: 2rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}

header h1 {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 1.25rem;
  line-height: 1.4;
  margin: 0 0 0.5rem 0;
  color: var(--fg);
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

header h1::before {
  content: '~';
  color: var(--accent);
  font-weight: 600;
}

.subtitle {
  font-family: var(--font-mono);
  color: var(--muted);
  font-size: 0.75rem;
  letter-spacing: 0.02em;
}

/* ============================================================================
   Search
   ============================================================================ */

.search-bar {
  margin-bottom: 1.5rem;
}

.search-bar input {
  width: 100%;
  padding: 0.75rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  border: 1px solid var(--input-border);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--fg);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.search-bar input::placeholder {
  color: var(--muted);
}

.search-bar input:focus {
  outline: none;
  border-color: var(--input-focus);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

/* ============================================================================
   Session List
   ============================================================================ */

.session-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.session-item {
  margin-bottom: 0.625rem;
}

.session-link {
  display: block;
  padding: 0.875rem 1rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 4px;
  transition: all 0.15s ease;
}

.session-link:hover {
  background: var(--card-hover);
  border-color: var(--card-border-hover);
  text-decoration: none;
  box-shadow: var(--shadow-sm);
}

.session-title {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  color: var(--fg);
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.session-title::before {
  content: '>';
  color: var(--accent);
  font-size: 0.75rem;
  opacity: 0.7;
}

.session-meta {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--muted);
  margin-left: 1rem;
}

.session-preview {
  font-size: 0.8125rem;
  color: var(--fg-secondary);
  margin-top: 0.375rem;
  margin-left: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.5;
}

.no-results {
  text-align: center;
  font-family: var(--font-mono);
  color: var(--muted);
  padding: 3rem;
  font-size: 0.875rem;
}

.hidden {
  display: none;
}

/* ============================================================================
   Session Groups
   ============================================================================ */

.session-group {
  margin-bottom: 1.5rem;
}

.group-header {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--muted);
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 0.5rem;
  letter-spacing: 0.02em;
}

.group-sessions {
  list-style: none;
  padding: 0;
  margin: 0;
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

  .index-container {
    padding: 1.5rem 1rem 3rem;
  }

  .index-container::before {
    display: none;
  }

  header h1 {
    font-size: 1.125rem;
  }

  .session-link {
    padding: 0.75rem;
  }
}
`;

// ============================================================================
// Client-side JavaScript
// ============================================================================

const INDEX_SCRIPT = `
(function() {
  const searchInput = document.getElementById('search');
  const sessionList = document.getElementById('sessions');
  const items = sessionList.querySelectorAll('.session-item');
  const noResults = document.getElementById('no-results');

  searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase().trim();
    let visibleCount = 0;

    items.forEach(function(item) {
      const title = item.dataset.title.toLowerCase();
      const preview = item.dataset.preview.toLowerCase();
      const matches = !query || title.includes(query) || preview.includes(query);

      if (matches) {
        item.classList.remove('hidden');
        visibleCount++;
      } else {
        item.classList.add('hidden');
      }
    });

    if (visibleCount === 0 && query) {
      noResults.classList.remove('hidden');
    } else {
      noResults.classList.add('hidden');
    }
  });
})();
`;

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + "...";
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/**
 * Format a date range compactly, e.g., "1/25 4:00-6:30"
 */
function formatDateRange(startIso: string, endIso?: string): string {
  try {
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : start;

    const month = start.getMonth() + 1;
    const day = start.getDate();
    const startTime = start.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });

    if (!endIso || start.getTime() === end.getTime()) {
      return `${month}/${day} ${startTime}`;
    }

    const endTime = end.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });

    // If same day, just show time range
    if (
      start.getDate() === end.getDate() &&
      start.getMonth() === end.getMonth()
    ) {
      return `${month}/${day} ${startTime}–${endTime}`;
    }

    // Different days
    const endMonth = end.getMonth() + 1;
    const endDay = end.getDate();
    return `${month}/${day} ${startTime} – ${endMonth}/${endDay} ${endTime}`;
  } catch {
    return startIso;
  }
}

export interface SessionEntry {
  filename: string;
  title: string;
  firstUserMessage: string;
  date: string; // ISO timestamp for sorting/display
  endDate: string; // ISO timestamp for time range display
  messageCount: number;
  cwd?: string; // optional since not all adapters may provide it
}

// ============================================================================
// Main Renderer
// ============================================================================

export interface RenderIndexOptions {
  title?: string;
}

/**
 * Render index.html from a list of session entries.
 */
export function renderIndexFromSessions(
  sessions: SessionEntry[],
  options: RenderIndexOptions = {},
): string {
  const { title = "Agent Transcripts" } = options;

  // Filter out empty sessions and sort by date (newest first)
  const filtered = sessions.filter((s) => s.messageCount > 0);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // Group by cwd
  const groups = new Map<string, SessionEntry[]>();
  for (const session of sorted) {
    const key = session.cwd || "(unknown)";
    const group = groups.get(key) || [];
    group.push(session);
    groups.set(key, group);
  }

  // Sort groups by most recent session
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const aDate = new Date(a[1][0].date).getTime();
    const bDate = new Date(b[1][0].date).getTime();
    return bDate - aDate;
  });

  // Build grouped session list HTML
  const groupsHtml = sortedGroups
    .map(([cwd, groupSessions]) => {
      const sessionsHtml = groupSessions
        .map((session) => {
          const preview = truncate(session.firstUserMessage, 120);
          const dateRange = formatDateRange(session.date, session.endDate);
          const msgCount = session.messageCount ?? "?";
          return `
      <li class="session-item" data-title="${escapeHtml(session.title)}" data-preview="${escapeHtml(session.firstUserMessage)}" data-cwd="${escapeHtml(cwd)}">
        <a href="${escapeHtml(session.filename)}" class="session-link">
          <div class="session-title">${escapeHtml(session.title)}</div>
          <div class="session-meta">${msgCount} msgs · ${dateRange}</div>
          ${preview ? `<div class="session-preview">${escapeHtml(preview)}</div>` : ""}
        </a>
      </li>`;
        })
        .join("");

      const cwdDisplay = cwd === "(unknown)" ? cwd : cwd.replace(/^\//, "");
      return `
    <li class="session-group" data-cwd="${escapeHtml(cwd)}">
      <div class="group-header">${escapeHtml(cwdDisplay)}</div>
      <ul class="group-sessions">
        ${sessionsHtml}
      </ul>
    </li>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${INDEX_STYLES}</style>
</head>
<body>
  <div class="index-container">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${sorted.length} session${sorted.length !== 1 ? "s" : ""}</p>
    </header>

    <div class="search-bar">
      <input type="text" id="search" placeholder="/ filter sessions..." autocomplete="off">
    </div>

    <ul id="sessions" class="session-list">
      ${groupsHtml}
    </ul>

    <div id="no-results" class="no-results hidden">
      No matching sessions found.
    </div>
  </div>

  <script>${INDEX_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Render index.html from transcripts.json data.
 * Convenience wrapper around renderIndexFromSessions.
 */
export function renderIndex(
  index: TranscriptsIndex,
  options: RenderIndexOptions = {},
): string {
  const sessions: SessionEntry[] = Object.entries(index.entries)
    .filter(([filename]) => filename.endsWith(".html"))
    .map(([filename, entry]) => ({
      filename,
      title:
        entry.title || truncate(entry.firstUserMessage, 80) || entry.sessionId,
      firstUserMessage: entry.firstUserMessage,
      date: entry.startTime,
      endDate: entry.endTime,
      messageCount: entry.messageCount,
      cwd: entry.cwd,
    }));

  return renderIndexFromSessions(sessions, options);
}
