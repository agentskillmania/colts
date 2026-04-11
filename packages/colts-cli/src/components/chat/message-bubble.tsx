/**
 * @fileoverview Single message rendering component — role label + content + streaming cursor
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';
import type { ChatMessage } from '../../hooks/use-agent.js';

/**
 * MessageBubble props
 */
interface MessageBubbleProps {
  /** Message content */
  message: ChatMessage;
}

/**
 * Role label colors
 */
const ROLE_COLORS: Record<string, string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.warning,
};

/**
 * Role display names
 */
const ROLE_LABELS: Record<string, string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

/**
 * Single message bubble component
 *
 * Displays different colored labels based on role, with streaming cursor support in the content area.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const color = ROLE_COLORS[message.role] ?? theme.dim;
  const label = ROLE_LABELS[message.role] ?? message.role;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text bold color={color}>
          [{label}]
        </Text>
        {message.isStreaming ? (
          <Text color={theme.accent}> {'|'}</Text>
        ) : null}
      </Box>
      <Text>{message.content}</Text>
    </Box>
  );
}
