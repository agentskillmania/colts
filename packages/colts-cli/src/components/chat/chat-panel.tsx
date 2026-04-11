/**
 * @fileoverview 消息列表容器 — 渲染 ChatMessage[] 列表，包含消息气泡和工具调用卡片
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
  /** 消息列表 */
  messages: ChatMessage[];
}

/**
 * 聊天面板组件
 *
 * 渲染所有消息气泡。消息之间有分隔线。
 * 空消息时显示欢迎提示。
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
