/**
 * @fileoverview EventsPanel — Event list container with windowed display
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DisplayEvent } from '../../hooks/use-events.js';
import { EventItem } from './event-item.js';
import { theme } from '../../utils/theme.js';

/** Maximum number of events to display */
const MAX_VISIBLE_EVENTS = 200;

/** EventsPanel props */
export interface EventsPanelProps {
  /** List of display events */
  events: DisplayEvent[];
}

/**
 * EventsPanel component
 *
 * Displays the most recent events up to MAX_VISIBLE_EVENTS.
 * Shows a placeholder message when no events are available.
 *
 * @param props - Events panel props
 */
export function EventsPanel({ events }: EventsPanelProps) {
  const visible = events.slice(-MAX_VISIBLE_EVENTS);
  const overflow = events.length - visible.length;

  return (
    <Box paddingX={1} flexDirection="column">
      {overflow > 0 && (
        <Text color={theme.dim}>
          ... {overflow} earlier event{overflow !== 1 ? 's' : ''}
        </Text>
      )}
      {visible.length === 0 ? (
        <Text color={theme.dim}>No events yet.</Text>
      ) : (
        visible.map((e) => <EventItem key={e.id} event={e} />)
      )}
    </Box>
  );
}
