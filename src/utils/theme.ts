/**
 * Shared CSS theme tokens and base styles used by both
 * render-html.ts (transcript pages) and render-index.ts (index page).
 */

export const THEME_VARS = `
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

  /* Links */
  --link: #60a5fa;
  --link-hover: #93c5fd;

  /* Shadows */
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

    --link: #2563eb;
    --link-hover: #1d4ed8;

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
}`;

export const BASE_RESET = `
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

a {
  color: var(--link);
  text-decoration: none;
  transition: color 0.15s ease;
}

a:hover {
  color: var(--link-hover);
}`;

export const SCROLLBAR_STYLES = `
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
}`;

/**
 * Accent bar on the left edge of the page, parameterized by container class.
 */
export function accentBar(containerClass: string): string {
  return `
.${containerClass}::before {
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
}`;
}

/**
 * Responsive breakpoint hiding the accent bar and shrinking fonts.
 * containerClass: the wrapper class to adjust padding on.
 */
export function responsiveBase(containerClass: string): string {
  return `
@media (max-width: 640px) {
  html {
    font-size: 14px;
  }

  .${containerClass} {
    padding: 1.5rem 1rem 3rem;
  }

  .${containerClass}::before {
    display: none;
  }
}`;
}
