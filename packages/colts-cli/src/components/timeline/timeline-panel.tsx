/**
 * @fileoverview Timeline container component — sorts by seq, filters by DetailLevel, renders TimelineEntry
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TimelineEntry, DetailLevel } from '../../types/timeline.js';
import { filterByDetailLevel } from '../../types/timeline.js';
import { TimelineEntry as TimelineEntryComponent } from './timeline-entry.js';

/**
 * TimelinePanel props
 */
export interface TimelinePanelProps {
  /** All timeline entries */
  entries: TimelineEntry[];
  /** Display level */
  detailLevel: DetailLevel;
}

/**
 * Entry types that need a blank line before them (visual separation)
 */
const GAP_BEFORE_TYPES = new Set(['step-start', 'run-complete', 'error']);

/**
 * Timeline container component
 *
 * Sorts by seq to ensure correct order, filters by detailLevel, then renders entry by entry.
 * Adds blank lines before specific entry types for visual separation.
 *
 * @param props - Component props
 * @returns Rendered Timeline panel or null (when no visible entries)
 */
export function TimelinePanel({ entries, detailLevel }: TimelinePanelProps) {
  // Sort by seq to ensure render order matches event generation order
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const visible = filterByDetailLevel(sorted, detailLevel);

  if (visible.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((entry, index) => (
        <Box key={entry.id} flexDirection="column">
          {/* Add blank line before specific entries for visual separation */}
          {index > 0 && GAP_BEFORE_TYPES.has(entry.type) && (
            <Box height={1}>
              <Text> </Text>
            </Box>
          )}
          <TimelineEntryComponent entry={entry} detailLevel={detailLevel} />
        </Box>
      ))}
    </Box>
  );
}
