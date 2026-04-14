/**
 * @fileoverview Header status bar — version, model, run status, keyboard shortcuts
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Badge, Spinner } from '@inkjs/ui';
import { theme } from '../../utils/theme.js';

/**
 * Run status type
 */
export type RunStatus = 'idle' | 'running' | 'error';

/**
 * HeaderBar props
 */
interface HeaderBarProps {
  /** Model name */
  model: string;
  /** Run status */
  status: RunStatus;
}

/** Status icon mapping */
const STATUS_CONFIG: Record<RunStatus, { color: 'gray' | 'yellow' | 'red'; label: string }> = {
  idle: { color: 'gray', label: 'Ready' },
  running: { color: 'yellow', label: 'Running' },
  error: { color: 'red', label: 'Error' },
};

/**
 * Header status bar component
 *
 * Left side displays version number, model name, and run status.
 * Right side displays keyboard shortcut hints.
 *
 * @param props - Component props
 * @param props.model - Model name
 * @param props.status - Run status
 * @returns Rendered header bar
 */
export function HeaderBar({ model, status }: HeaderBarProps) {
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
          Ctrl+C: {status === 'running' ? 'interrupt' : 'exit'}
        </Text>
      </Box>
    </Box>
  );
}
