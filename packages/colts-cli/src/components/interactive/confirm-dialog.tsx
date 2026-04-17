/**
 * @fileoverview Confirm 对话框 — 危险工具执行前确认
 *
 * 显示工具名和参数预览，用户按 Y 确认或 n 取消。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import { theme } from '../../utils/theme.js';

interface ConfirmDialogProps {
  toolName: string;
  args: Record<string, unknown>;
  onResult: (approved: boolean) => void;
}

/**
 * Confirm 对话框组件
 *
 * 显示工具调用信息，等待用户 Y/n 确认。
 */
export function ConfirmDialog({ toolName, args, onResult }: ConfirmDialogProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.warning}>
        Confirm tool execution
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>Tool: </Text>
          <Text color={theme.accent}>{toolName}</Text>
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>Arguments:</Text>
          {Object.entries(args).map(([key, value]) => (
            <Box key={key} marginLeft={2}>
              <Text>
                {key}: {JSON.stringify(value)}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box marginTop={1}>
        <ConfirmInput onConfirm={() => onResult(true)} onCancel={() => onResult(false)} />
      </Box>
    </Box>
  );
}
