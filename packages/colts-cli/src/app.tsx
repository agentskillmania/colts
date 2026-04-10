/**
 * @fileoverview ink 根组件 — TUI 主入口
 */

import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { theme } from './utils/theme.js';

export interface AppConfig {
  /** 是否已有有效配置（LLM provider + apiKey） */
  hasValidConfig: boolean;
  /** LLM 配置 */
  llm?: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
}

interface AppProps {
  config: AppConfig;
}

/**
 * colts-cli 根组件
 *
 * @param props - 应用配置
 */
export function App({ config }: AppProps) {
  const { exit } = useApp();
  const isSetup = !config.hasValidConfig;

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === 'c') {
      exit();
      return;
    }

    if (key.escape) {
      exit();
      return;
    }
  });

  if (isSetup) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.warning}>No configuration found</Text>
        <Text color={theme.dim}>
          Set up your LLM provider using:
        </Text>
        <Text color={theme.info}>  /config llm.provider openai</Text>
        <Text color={theme.info}>  /config llm.apiKey sk-...</Text>
        <Text color={theme.info}>  /config llm.model gpt-4</Text>
        <Box marginTop={1}>
          <Text color={theme.dim}>
            Press Ctrl+C to exit.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={theme.success}>colts-cli v0.1.0</Text>
      <Text color={theme.dim}>Ready. Type your message and press Enter.</Text>
      <Box marginTop={1}>
        <Text color={theme.info}>{'>'} </Text>
      </Box>
    </Box>
  );
}
