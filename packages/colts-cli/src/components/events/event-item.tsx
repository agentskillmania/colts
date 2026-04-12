/**
 * @fileoverview EventItem — Renders a single event with type-based color and icon
 */

import React from 'react';
import { Text } from 'ink';
import type { DisplayEvent } from '../../hooks/use-events.js';
import { theme } from '../../utils/theme.js';

/**
 * Map event type to display color
 *
 * @param eventType - StreamEvent type string
 * @returns ANSI color name
 */
function getEventColor(eventType: string): string {
  switch (eventType) {
    case 'phase-change':
      return theme.dim;
    case 'token':
      return theme.info;
    case 'tool:start':
      return theme.warning;
    case 'tool:end':
      return theme.success;
    case 'error':
      return theme.error;
    case 'compressing':
    case 'compressed':
      return theme.accent;
    case 'skill:loading':
    case 'skill:loaded':
      return theme.info;
    case 'subagent:start':
    case 'subagent:token':
    case 'subagent:step:end':
    case 'subagent:end':
      return theme.accent;
    default:
      return theme.dim;
  }
}

/**
 * Map event type to icon prefix
 *
 * @param eventType - StreamEvent type string
 * @returns Icon string (may be empty)
 */
function getEventIcon(eventType: string): string {
  switch (eventType) {
    case 'phase-change':
      return '\u25B6 '; // ▶
    case 'tool:start':
      return '\u2699 '; // ⚙
    case 'tool:end':
      return '\u2713 '; // ✓
    case 'error':
      return '\u2717 '; // ✗
    case 'skill:loading':
    case 'skill:loaded':
      return '\u2605 '; // ★
    case 'subagent:start':
      return '\u25B6 '; // ▶
    default:
      return '';
  }
}

/** EventItem props */
interface EventItemProps {
  /** Display event to render */
  event: DisplayEvent;
}

/**
 * EventItem component
 *
 * Renders a single event with a type-specific color and icon prefix.
 *
 * @param props - Event item props
 */
export function EventItem({ event }: EventItemProps) {
  const color = getEventColor(event.type);
  const icon = getEventIcon(event.type);
  const indent = event.indent ? '  '.repeat(event.indent) : '';

  return (
    <Text color={color}>
      {indent}{icon}{event.text}
    </Text>
  );
}
