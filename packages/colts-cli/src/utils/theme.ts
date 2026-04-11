/**
 * @fileoverview Semantic color definitions — uses ANSI foreground colors, follows terminal theme
 *
 * No hardcoded background colors. All colors use semantic naming.
 */

/**
 * Semantic color map
 *
 * Automatically adapts to dark/light terminal themes.
 * Uses chalk color names for ANSI compatibility.
 */
export const theme = {
  /** Success — green */
  success: 'green',
  /** Error — red */
  error: 'red',
  /** Info — cyan */
  info: 'cyan',
  /** Warning — yellow */
  warning: 'yellow',
  /** Tool call — gray */
  tool: 'gray',
  /** Secondary/dimmed text — gray */
  dim: 'gray',
  /** User message — blue */
  user: 'blue',
  /** Assistant message — white (default) */
  assistant: 'white',
  /** Accent — magenta */
  accent: 'magenta',
} as const;

/**
 * Theme color type
 */
export type ThemeColor = (typeof theme)[keyof typeof theme];
