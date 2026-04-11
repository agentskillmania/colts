/**
 * @fileoverview 模式标签组件 — 显示当前执行模式
 */

import React from 'react';
import { Badge } from '@inkjs/ui';

/**
 * 执行模式
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * ModeBadge props
 */
interface ModeBadgeProps {
  /** 当前执行模式 */
  mode: ExecutionMode;
}

/** 模式与颜色/标签映射 */
const MODE_CONFIG: Record<ExecutionMode, { color: 'green' | 'yellow' | 'blue'; label: string }> = {
  run: { color: 'green', label: 'RUN' },
  step: { color: 'yellow', label: 'STEP' },
  advance: { color: 'blue', label: 'ADV' },
};

/**
 * 模式标签组件
 *
 * 用 @inkjs/ui Badge 渲染当前执行模式标签。
 *
 * @param props - 组件属性
 */
export function ModeBadge({ mode }: ModeBadgeProps) {
  const config = MODE_CONFIG[mode];
  return <Badge color={config.color}>{config.label}</Badge>;
}
