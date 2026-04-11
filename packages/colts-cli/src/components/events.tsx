/**
 * @fileoverview Events — Event panel component
 *
 * Displays the event stream during agent execution, including phase changes,
 * tool calls, token output, compression, and other events.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';
import type { DisplayEvent } from '../hooks/use-events.js';

/**
 * Events props
 */
interface EventsProps {
  /** Event list */
  events: DisplayEvent[];
  /** Panel height (optional) */
  height?: number;
}

/** Event type to color mapping */
const EVENT_COLORS: Record<string, string> = {
  'phase-change': theme.info,
  token: theme.dim,
  'tool:start': theme.tool,
  'tool:end': theme.success,
  error: theme.error,
  compressing: theme.warning,
  compressed: theme.warning,
  // Skill events
  'skill:loading': theme.warning,
  'skill:loaded': theme.success,
  // Sub-agent events
  'subagent:start': theme.info,
  'subagent:token': theme.dim,
  'subagent:step:end': theme.dim,
  'subagent:end': theme.success,
};

/**
 * Get display color for an event type
 *
 * @param type - Event type
 * @returns Color name
 */
function getEventColor(type: string): string {
  return EVENT_COLORS[type] ?? theme.dim;
}

/**
 * Event panel component
 *
 * Displays execution events as a list, each with a color indicator based on event type.
 *
 * @param props - Component props
 * @returns Rendered event panel
 *
 * @example
 * ```tsx
 * <Events events={displayEvents} />
 * ```
 */
export function Events({ events }: EventsProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {events.map((evt) => (
        <Box key={evt.id} marginLeft={evt.indent ?? 0}>
          <Text color={getEventColor(evt.type)}>{evt.text}</Text>
        </Box>
      ))}
    </Box>
  );
}
