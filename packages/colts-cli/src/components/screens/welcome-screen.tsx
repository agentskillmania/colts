/**
 * @fileoverview Welcome screen — displayed when no session is active
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * WelcomeScreen props
 */
interface WelcomeScreenProps {
  /** Agent name */
  agentName?: string;
  /** Current model name */
  model?: string;
}

/**
 * Welcome screen component
 *
 * Displays welcome message, agent name, and model information.
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
