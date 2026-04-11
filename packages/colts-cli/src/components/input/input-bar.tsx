/**
 * @fileoverview 输入栏组件 — 底部命令输入区域
 *
 * 显示当前模式标签、文本输入框、运行指示器。
 * 运行时禁用输入，显示 Spinner。
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
  /** 提交回调 */
  onSubmit: (value: string) => void;
  /** 当前执行模式 */
  mode: ExecutionMode;
  /** 是否正在运行 */
  isRunning: boolean;
}

/**
 * 输入栏组件
 *
 * 底部固定区域。运行中显示 Spinner 并禁用输入，
 * 空闲时接受用户输入。使用 @inkjs/ui 的 TextInput（非受控）。
 *
 * @param props - 组件属性
 */
export function InputBar({ onSubmit, mode, isRunning }: InputBarProps) {
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = (value: string) => {
    if (value.trim() && !isRunning) {
      onSubmit(value.trim());
      // 重新挂载 TextInput 清空内容
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
