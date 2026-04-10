/**
 * @fileoverview StatusIndicator — 可复用的状态指示器组件
 *
 * 根据 type 属性显示不同状态图标和颜色。
 * 支持 loading / success / error / idle 四种状态。
 */

import React from 'react';
import { Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * StatusIndicator 属性
 */
interface StatusIndicatorProps {
  /** 状态类型 */
  type: 'loading' | 'success' | 'error' | 'idle';
  /** 显示文字（默认使用 type 值） */
  text?: string;
}

/** 状态图标映射 */
const STATUS_SYMBOLS: Record<StatusIndicatorProps['type'], string> = {
  loading: '◐',
  success: '✔',
  error: '✖',
  idle: '○',
};

/** 状态颜色映射 */
const STATUS_COLORS: Record<StatusIndicatorProps['type'], string> = {
  loading: theme.warning,
  success: theme.success,
  error: theme.error,
  idle: theme.dim,
};

/**
 * 状态指示器组件
 *
 * 显示状态图标和文字，常用于表示加载、成功、错误、空闲等状态。
 *
 * @param props - 组件属性
 * @returns 渲染的状态指示器
 *
 * @example
 * ```tsx
 * <StatusIndicator type="loading" text="正在加载..." />
 * <StatusIndicator type="success" text="完成" />
 * <StatusIndicator type="error" text="出错了" />
 * ```
 */
export function StatusIndicator({ type, text }: StatusIndicatorProps) {
  const symbol = STATUS_SYMBOLS[type];
  const color = STATUS_COLORS[type];
  const displayText = text ?? type;

  return (
    <Text color={color}>
      {symbol} {displayText}
    </Text>
  );
}
