/**
 * @fileoverview Chat — Chat panel component
 *
 * Displays conversation message list with role-based colors for user, assistant, and system messages.
 * Shows cursor symbol ▌ during streaming output.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';
import type { ChatMessage } from '../hooks/use-agent.js';

/**
 * Chat props
 */
interface ChatProps {
  /** Message list */
  messages: ChatMessage[];
  /** Panel height (optional, for limiting display area) */
  height?: number;
}

/** Role display name mapping */
const ROLE_LABELS: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Agent',
  system: 'System',
};

/** Role color mapping */
const ROLE_COLORS: Record<ChatMessage['role'], string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.dim,
};

/** Streaming output cursor */
const STREAMING_CURSOR = '▌';

/**
 * Chat panel component
 *
 * Displays messages as a conversation list, each with a role label and color.
 * Shows a dynamic cursor during streaming output.
 *
 * @param props - Component props
 * @returns Rendered chat panel
 *
 * @example
 * ```tsx
 * <Chat messages={messages} />
 * ```
 */
export function Chat({ messages }: ChatProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg) => (
        <Box key={msg.id} marginBottom={0}>
          <Text color={ROLE_COLORS[msg.role]}>
            {ROLE_LABELS[msg.role]}:{' '}
          </Text>
          <Text>
            {msg.content}
            {msg.isStreaming ? STREAMING_CURSOR : ''}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
