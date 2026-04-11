/**
 * @fileoverview Input bar component — bottom command input area
 *
 * Displays the current mode badge, text input, and running indicator.
 * Disables input while running and shows a Spinner.
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput, Spinner } from '@inkjs/ui';
import { ModeBadge } from './mode-badge.js';
import type { ExecutionMode } from './mode-badge.js';
import { theme } from '../../utils/theme.js';

/**
 * InputBar props
 */
interface InputBarProps {
  /** Submit callback */
  onSubmit: (value: string) => void;
  /** Current execution mode */
  mode: ExecutionMode;
  /** Whether the agent is currently running */
  isRunning: boolean;
}

/**
 * Input bar component
 *
 * Fixed bottom area. Shows a Spinner and disables input while running,
 * accepts user input when idle. Uses @inkjs/ui TextInput (uncontrolled).
 *
 * @param props - Component props
 */
export function InputBar({ onSubmit, mode, isRunning }: InputBarProps) {
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = (value: string) => {
    if (value.trim() && !isRunning) {
      onSubmit(value.trim());
      // Remount TextInput to clear content
      setInputKey((k) => k + 1);
    }
  };

  return (
    <Box borderStyle="single" borderColor={theme.dim} paddingX={1}>
      <Box marginRight={1}>
        <ModeBadge mode={mode} />
      </Box>
      <Text color={theme.info}>{'>'} </Text>
      {isRunning ? (
        <Spinner label="Agent is thinking..." />
      ) : (
        <TextInput
          key={inputKey}
          placeholder="Type your message..."
          onSubmit={handleSubmit}
        />
      )}
    </Box>
  );
}
