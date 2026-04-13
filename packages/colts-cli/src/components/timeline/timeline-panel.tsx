/**
 * @fileoverview 时间线容器组件 — 根据 DetailLevel 过滤并渲染 TimelineEntry
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
  /** 所有时间线条目 */
  entries: TimelineEntry[];
  /** 展示级别 */
  detailLevel: DetailLevel;
}

/**
 * 时间线容器组件
 *
 * 根据 detailLevel 过滤条目后逐条渲染。
 *
 * @param props - entries 和 detailLevel
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
