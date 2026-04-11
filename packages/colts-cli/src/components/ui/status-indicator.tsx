/**
 * @fileoverview StatusIndicator — Reusable status indicator component
 *
 * Displays different status icons and colors based on the type prop.
 * Supports loading / success / error / idle states.
 */

import React from 'react';
import { Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * StatusIndicator props
 */
interface StatusIndicatorProps {
  /** Status type */
  type: 'loading' | 'success' | 'error' | 'idle';
  /** Display text (defaults to type value) */
  text?: string;
}

/** Status icon mapping */
const STATUS_SYMBOLS: Record<StatusIndicatorProps['type'], string> = {
  loading: '◐',
  success: '✔',
  error: '✖',
  idle: '○',
};

/** Status color mapping */
const STATUS_COLORS: Record<StatusIndicatorProps['type'], string> = {
  loading: theme.warning,
  success: theme.success,
  error: theme.error,
  idle: theme.dim,
};

/**
 * Status indicator component
 *
 * Displays a status icon and text, commonly used for loading, success, error, and idle states.
 *
 * @param props - Component props
 * @returns Rendered status indicator
 *
 * @example
 * ```tsx
 * <StatusIndicator type="loading" text="Loading..." />
 * <StatusIndicator type="success" text="Done" />
 * <StatusIndicator type="error" text="Error" />
 * ```
 */
export function StatusIndicator({ type, text }: StatusIndicatorProps) {
  const symbol = STATUS_SYMBOLS[type];
  const color = STATUS_COLORS[type];
  const displayText = text ?? type;

  return (
    <Text color={color}>
      {symbol} {displayText}
    </Text>
  );
}
