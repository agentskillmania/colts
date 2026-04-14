/**
 * @fileoverview Header status bar — version, model, run status, skill breadcrumb, keyboard shortcuts
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Badge, Spinner } from '@inkjs/ui';
import { theme } from '../../utils/theme.js';
import type { SkillState } from '@agentskillmania/colts';

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
  /** Current skill state for breadcrumb display */
  skillState?: SkillState;
}

/** Status icon mapping */
const STATUS_CONFIG: Record<RunStatus, { color: 'gray' | 'yellow' | 'red'; label: string }> = {
  idle: { color: 'gray', label: 'Ready' },
  running: { color: 'yellow', label: 'Running' },
  error: { color: 'red', label: 'Error' },
};

/**
 * Build skill breadcrumb from current skill state
 *
 * Format: "parent › child › current" (using stack + current)
 *
 * @param skillState - Current skill state
 * @returns Breadcrumb string or null
 */
function buildBreadcrumb(skillState: SkillState | undefined): string | null {
  if (!skillState || !skillState.current) return null;
  const parts = skillState.stack.map((f) => f.skillName);
  parts.push(skillState.current);
  return parts.join(' › ');
}

/**
 * Header status bar component
 *
 * Left side displays version number, model name, run status, and skill breadcrumb.
 * Right side displays keyboard shortcut hints.
 *
 * @param props - Component props
 * @param props.model - Model name
 * @param props.status - Run status
 * @param props.skillState - Current skill state for breadcrumb
 * @returns Rendered header bar
 */
export function HeaderBar({ model, status, skillState }: HeaderBarProps) {
  const statusConfig = STATUS_CONFIG[status];
  const breadcrumb = buildBreadcrumb(skillState);

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
        {breadcrumb && (
          <>
            <Text color={theme.dim}>{' │ '}</Text>
            <Text color={theme.info}>{breadcrumb}</Text>
          </>
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
