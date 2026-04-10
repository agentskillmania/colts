/**
 * @fileoverview Events — 事件面板组件
 *
 * 显示 Agent 执行过程中的事件流，包括相位变化、工具调用、
 * Token 输出、压缩等事件。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';
import type { DisplayEvent } from '../hooks/use-events.js';

/**
 * Events 属性
 */
interface EventsProps {
  /** 事件列表 */
  events: DisplayEvent[];
  /** 面板高度（可选） */
  height?: number;
}

/** 事件类型到颜色的映射 */
const EVENT_COLORS: Record<string, string> = {
  'phase-change': theme.info,
  token: theme.dim,
  'tool:start': theme.tool,
  'tool:end': theme.success,
  error: theme.error,
  compressing: theme.warning,
  compressed: theme.warning,
};

/**
 * 获取事件类型的显示颜色
 *
 * @param type - 事件类型
 * @returns 颜色名称
 */
function getEventColor(type: string): string {
  return EVENT_COLORS[type] ?? theme.dim;
}

/**
 * 事件面板组件
 *
 * 以列表形式显示执行事件，每个事件带有类型对应的颜色标识。
 *
 * @param props - 组件属性
 * @returns 渲染的事件面板
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
        <Box key={evt.id}>
          <Text color={getEventColor(evt.type)}>{evt.text}</Text>
        </Box>
      ))}
    </Box>
  );
}
