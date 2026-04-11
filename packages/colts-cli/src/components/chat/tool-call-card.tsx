/**
 * @fileoverview Tool call display card — tool name + arguments + result
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * Tool call data
 */
export interface ToolCallData {
  /** Tool name */
  tool: string;
  /** Call arguments (JSON string or object) */
  args?: unknown;
  /** Tool execution result */
  result?: unknown;
  /** Whether the tool is currently running */
  isRunning?: boolean;
}

/**
 * ToolCallCard props
 */
interface ToolCallCardProps {
  /** Tool call data */
  data: ToolCallData;
}

/**
 * Truncate text to a specified length
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * Format arguments/results into a readable string
 */
function formatValue(value: unknown, maxLen = 80): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return truncate(str, maxLen);
}

/**
 * Tool call card component
 *
 * Displays tool name, argument summary, and execution result.
 * Shows spinner text when isRunning is true.
 */
export function ToolCallCard({ data }: ToolCallCardProps) {
  return (
    <Box
      flexDirection="column"
      marginLeft={2}
      borderStyle="round"
      borderColor={theme.tool}
      paddingX={1}
    >
      <Box>
        <Text color={theme.tool}>{'>'} </Text>
        <Text bold color={theme.tool}>
          {data.tool}
        </Text>
        {data.isRunning && <Text color={theme.warning}> running...</Text>}
      </Box>
      {data.args !== undefined && (
        <Text color={theme.dim}>{formatValue(data.args)}</Text>
      )}
      {data.result !== undefined && (
        <Box>
          <Text color={theme.success}>{'= '}</Text>
          <Text color={theme.dim}>{formatValue(data.result)}</Text>
        </Box>
      )}
    </Box>
  );
}
