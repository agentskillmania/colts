/**
 * @fileoverview 顶部状态栏 — 版本、模型、运行状态、快捷键提示
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Badge, Spinner } from '@inkjs/ui';
import { theme } from '../../utils/theme.js';

/**
 * 运行状态
 */
export type RunStatus = 'idle' | 'running' | 'error';

/**
 * HeaderBar props
 */
interface HeaderBarProps {
  /** 模型名称 */
  model: string;
  /** 运行状态 */
  status: RunStatus;
  /** 右侧面板是否可见 */
  eventsVisible: boolean;
}

/** 状态图标映射 */
const STATUS_CONFIG: Record<RunStatus, { color: 'gray' | 'yellow' | 'red'; label: string }> = {
  idle: { color: 'gray', label: 'Ready' },
  running: { color: 'yellow', label: 'Running' },
  error: { color: 'red', label: 'Error' },
};

/**
 * 顶部状态栏组件
 *
 * 左侧显示版本号、模型名、运行状态。
 * 右侧显示快捷键提示。
 *
 * @param props - 组件属性
 */
export function HeaderBar({ model, status, eventsVisible }: HeaderBarProps) {
  const statusConfig = STATUS_CONFIG[status];

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        <Text color={theme.success} bold>
          colts-cli v0.1.0
        </Text>
        <Text color={theme.dim}>{' │ '}</Text>
        <Text color={theme.info}>{model}</Text>
        <Text color={theme.dim}>{' │ '}</Text>
        {status === 'running' ? (
          <Spinner label="Running" />
        ) : (
          <Badge color={statusConfig.color}>{statusConfig.label}</Badge>
        )}
      </Box>
      <Box>
        <Text color={theme.dim}>
          Ctrl+E: {eventsVisible ? 'hide' : 'show'} events{' │ '}Ctrl+C: exit
        </Text>
      </Box>
    </Box>
  );
}
