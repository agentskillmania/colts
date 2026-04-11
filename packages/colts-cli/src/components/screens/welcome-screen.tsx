/**
 * @fileoverview 欢迎屏幕 — 无 session 时的欢迎界面
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * WelcomeScreen props
 */
interface WelcomeScreenProps {
  /** Agent 名称 */
  agentName?: string;
  /** 当前模型名 */
  model?: string;
}

/**
 * 欢迎屏幕组件
 *
 * 显示欢迎语、agent 名称和模型信息。
 */
export function WelcomeScreen({ agentName, model }: WelcomeScreenProps) {
  return (
    <Box flexDirection="column" paddingX={1} justifyContent="center">
      <Text bold color={theme.info}>
        Welcome to colts-cli
      </Text>
      {agentName && (
        <Box marginTop={1}>
          <Text color={theme.dim}>Agent: </Text>
          <Text>{agentName}</Text>
        </Box>
      )}
      {model && (
        <Box>
          <Text color={theme.dim}>Model: </Text>
          <Text>{model}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.dim}>Type a message below to start. Use /help for commands.</Text>
      </Box>
    </Box>
  );
}
