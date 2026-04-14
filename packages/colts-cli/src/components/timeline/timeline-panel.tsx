/**
 * @fileoverview Timeline container component — filters and renders TimelineEntry by DetailLevel
 */

import React from 'react';
import { Box } from 'ink';
import type { TimelineEntry, DetailLevel } from '../../types/timeline.js';
import { filterByDetailLevel } from '../../types/timeline.js';
import { TimelineEntry as TimelineEntryComponent } from './timeline-entry.js';

/**
 * TimelinePanel props
 */
export interface TimelinePanelProps {
  /** All timeline entries */
  entries: TimelineEntry[];
  /** Detail level */
  detailLevel: DetailLevel;
}

/**
 * Timeline container component
 *
 * Filters entries by detailLevel and renders them one by one.
 *
 * @param props - Component props
 * @param props.entries - All timeline entries
 * @param props.detailLevel - Display detail level
 * @returns Rendered timeline panel or null if no visible entries
 */
export function TimelinePanel({ entries, detailLevel }: TimelinePanelProps) {
  const visible = filterByDetailLevel(entries, detailLevel);

  if (visible.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((entry) => (
        <TimelineEntryComponent key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}
