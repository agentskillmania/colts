/**
 * @fileoverview Root ink component — TUI main entry point
 */

import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { theme } from './utils/theme.js';

export interface AppConfig {
  /** Whether a valid config exists (LLM provider + apiKey) */
  hasValidConfig: boolean;
  /** Path to the config file (for display) */
  configPath?: string;
  /** LLM configuration */
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
 * colts-cli root component
 *
 * @param props - Application configuration
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
        <Text color={theme.warning}>Configuration incomplete</Text>
        {config.configPath && (
          <Box marginTop={1}>
            <Text color={theme.dim}>Config file: </Text>
            <Text color={theme.info}>{config.configPath}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.dim}>Edit the file and fill in at least:</Text>
        </Box>
        <Text color={theme.info}>  llm.provider</Text>
        <Text color={theme.info}>  llm.apiKey</Text>
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
