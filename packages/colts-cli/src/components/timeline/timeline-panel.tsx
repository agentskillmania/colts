/**
 * @fileoverview Timeline 容器组件 — 按 seq 排序、按 DetailLevel 过滤、渲染 TimelineEntry
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
  /** 所有 timeline 条目 */
  entries: TimelineEntry[];
  /** 显示级别 */
  detailLevel: DetailLevel;
}

/**
 * 需要在前面加空行的条目类型（视觉分隔）
 */
const GAP_BEFORE_TYPES = new Set(['step-start', 'run-complete', 'error']);

/**
 * Timeline 容器组件
 *
 * 先按 seq 排序保证顺序正确，再按 detailLevel 过滤，最后逐条渲染。
 * 特定条目类型前加空行增加视觉分隔。
 *
 * @param props - 组件 props
 * @returns 渲染的 Timeline 面板或 null（无可见条目时）
 */
export function TimelinePanel({ entries, detailLevel }: TimelinePanelProps) {
  // 按 seq 排序，保证渲染顺序与事件产生顺序一致
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const visible = filterByDetailLevel(sorted, detailLevel);

  if (visible.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((entry, index) => (
        <Box key={entry.id} flexDirection="column">
          {/* 特定条目前加空行增加视觉分隔 */}
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
