/**
 * @fileoverview Message list container — renders ChatMessage[] list with message bubbles and tool call cards
 */

import React from 'react';
import { Box, Text } from 'ink';
import { MessageBubble } from './message-bubble.js';
import type { ChatMessage } from '../../hooks/use-agent.js';
import { theme } from '../../utils/theme.js';

/**
 * ChatPanel props
 */
interface ChatPanelProps {
  /** Message list */
  messages: ChatMessage[];
}

/**
 * Chat panel component
 *
 * Renders all message bubbles with separators between messages.
 * Shows a welcome prompt when there are no messages.
 */
export function ChatPanel({ messages }: ChatPanelProps) {
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.dim}>No messages yet. Type to start a conversation.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map((msg, idx) => (
        <Box key={msg.id} flexDirection="column">
          <MessageBubble message={msg} />
          {idx < messages.length - 1 && <Text>{' '}</Text>}
        </Box>
      ))}
    </Box>
  );
}
