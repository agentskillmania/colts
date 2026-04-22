/**
 * @fileoverview CLI visual design spec — colors, icons, formatting utilities
 *
 * All visual-related constants and utility functions are centralized in this file.
 * Components only reference constants from this file, without hard-coding colors or icons.
 */

// ── Colors ──

/**
 * Semantic color map
 *
 * Auto-adapts to dark/light terminal themes.
 * Uses chalk color names for ANSI compatibility.
 *
 * Usage rules:
 * - accent (magenta): skill-related states
 * - info (cyan): informational events (compress, subagent start, system)
 * - success (green): completion events (tool done, skill loaded/completed, step end done)
 * - warning (yellow): in-progress (tool running, skill loading)
 * - error (red): errors and failures
 * - dim (gray): secondary info (timestamps, args, phase, duration)
 * - user (blue): user input
 * - assistant (white): agent reply
 * - tool (gray): reserved; prefer warning/success to distinguish running/completed
 */
export const theme = {
  success: 'green',
  error: 'red',
  info: 'cyan',
  warning: 'yellow',
  tool: 'gray',
  dim: 'gray',
  user: 'blue',
  assistant: 'white',
  accent: 'magenta',
} as const;

/**
 * Color type
 */
export type ThemeColor = (typeof theme)[keyof typeof theme];

// ── Icons ──

/**
 * Icons for each TimelineEntry type
 *
 * Selects widely supported Unicode characters to avoid terminal compatibility issues.
 */
export const ICONS = {
  /** User message */
  user: '❯',
  /** Agent reply */
  assistant: '◀',
  /** Tool running */
  toolRunning: '⚙',
  /** Tool completed */
  toolDone: '✓',
  /** Tool failed */
  toolError: '✗',
  /** Phase change */
  phase: '·',
  /** Thought */
  thought: '◉',
  /** Compress */
  compress: '»',
  /** Skill */
  skill: '◆',
  /** SubAgent */
  subagent: '⇢',
  /** System message */
  system: 'ℹ',
  /** Divider */
  separator: '─',
} as const;

// ── Formatting utilities ──

/**
 * Format timestamp as HH:MM:SS
 *
 * Uses fixed format without locale dependency for cross-system consistency.
 *
 * @param ts - Millisecond timestamp
 * @returns Time string in HH:MM:SS format
 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Format duration
 *
 * @param ms - Milliseconds
 * @returns Human-readable duration string, e.g., "1.2s" or "350ms"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Truncate string to maximum length
 *
 * @param s - Input string
 * @param max - Maximum length
 * @returns Truncated string; excess replaced with "..."
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '...';
}

/**
 * Format tool arguments as readable string
 *
 * @param args - Tool argument object or raw value
 * @returns Formatted string
 */
export function formatArgs(args: unknown): string {
  if (typeof args === 'object' && args !== null) {
    const entries = Object.entries(args as Record<string, unknown>);
    return entries.map(([k, v]) => `${k}: ${truncate(String(v), 60)}`).join('\n     ');
  }
  return truncate(String(args), 80);
}

/**
 * Format tool result as readable string
 *
 * @param result - Tool result value
 * @returns Formatted string
 */
export function formatResult(result: unknown): string {
  if (result === undefined) return '';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return truncate(str, 80);
}
