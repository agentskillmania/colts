/**
 * @fileoverview Input — Input box component
 *
 * Bottom input box displaying the current execution mode label and input cursor.
 * Shows a dynamic indicator when running.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../utils/theme.js';
import type { ExecutionMode } from '../hooks/use-agent.js';

/**
 * Input props
 */
interface InputProps {
  /** Submit callback */
  onSubmit: (value: string) => void;
  /** Current execution mode */
  mode: ExecutionMode;
  /** Whether currently running */
  isRunning: boolean;
}

/** Mode label mapping */
const MODE_LABELS: Record<ExecutionMode, string> = {
  run: 'RUN',
  step: 'STEP',
  advance: 'ADV',
};

/** Running indicator */
const RUNNING_INDICATOR = ' ●';

/**
 * Input box component
 *
 * Displays the current execution mode label and accepts user input.
 * Press Enter to submit, shows a dynamic indicator when running.
 *
 * @param props - Component props
 * @returns Rendered input box
 *
 * @example
 * ```tsx
 * <Input onSubmit={handleSubmit} mode="run" isRunning={false} />
 * ```
 */
export function Input({ onSubmit, mode, isRunning }: InputProps) {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.return && value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  });

  const modeLabel = MODE_LABELS[mode];

  return (
    <Box borderStyle="single" borderColor={theme.dim} paddingX={1}>
      <Text color={theme.accent}>[{modeLabel}]</Text>
      <Text color={theme.info}>{' > '}</Text>
      <TextInput value={value} onChange={setValue} showCursor={true} />
      {isRunning && <Text color={theme.warning}>{RUNNING_INDICATOR}</Text>}
    </Box>
  );
}
