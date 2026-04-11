/**
 * @fileoverview 单条消息渲染组件 — 角色标签 + 内容 + 流式游标
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';
import type { ChatMessage } from '../../hooks/use-agent.js';

/**
 * MessageBubble props
 */
interface MessageBubbleProps {
  /** 消息内容 */
  message: ChatMessage;
}

/**
 * 角色标签颜色
 */
const ROLE_COLORS: Record<string, string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.warning,
};

/**
 * 角色显示名称
 */
const ROLE_LABELS: Record<string, string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

/**
 * 单条消息气泡组件
 *
 * 根据角色显示不同颜色标签，内容区域支持流式游标。
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
