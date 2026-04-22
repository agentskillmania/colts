/**
 * @fileoverview Confirm dialog — confirmation before executing dangerous tools
 *
 * Displays tool name and parameter preview; user presses Y to confirm or n to cancel.
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
 * Confirm dialog component
 *
 * Displays tool call information and waits for user Y/n confirmation.
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
