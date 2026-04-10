/**
 * @fileoverview Chat — 聊天面板组件
 *
 * 显示对话消息列表，区分用户、助手和系统消息的角色颜色。
 * 流式输出时显示光标符号 ▌。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';
import type { ChatMessage } from '../hooks/use-agent.js';

/**
 * Chat 属性
 */
interface ChatProps {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 面板高度（可选，用于限制显示区域） */
  height?: number;
}

/** 角色显示名映射 */
const ROLE_LABELS: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Agent',
  system: 'System',
};

/** 角色颜色映射 */
const ROLE_COLORS: Record<ChatMessage['role'], string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.dim,
};

/** 流式输出光标 */
const STREAMING_CURSOR = '▌';

/**
 * 聊天面板组件
 *
 * 以对话列表形式展示消息，每条消息带有角色标签和颜色。
 * 支持流式输出时显示动态光标。
 *
 * @param props - 组件属性
 * @returns 渲染的聊天面板
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
