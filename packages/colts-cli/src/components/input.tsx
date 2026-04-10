/**
 * @fileoverview Input — 输入框组件
 *
 * 底部输入框，显示当前执行模式标签和输入光标。
 * 运行时显示动态指示器。
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../utils/theme.js';
import type { ExecutionMode } from '../hooks/use-agent.js';

/**
 * Input 属性
 */
interface InputProps {
  /** 提交回调 */
  onSubmit: (value: string) => void;
  /** 当前执行模式 */
  mode: ExecutionMode;
  /** 是否正在运行 */
  isRunning: boolean;
}

/** 模式标签映射 */
const MODE_LABELS: Record<ExecutionMode, string> = {
  run: 'RUN',
  step: 'STEP',
  advance: 'ADV',
};

/** 运行指示器 */
const RUNNING_INDICATOR = ' ●';

/**
 * 输入框组件
 *
 * 显示当前执行模式标签，接收用户输入。
 * 按 Enter 提交输入，运行中显示动态指示器。
 *
 * @param props - 组件属性
 * @returns 渲染的输入框
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
