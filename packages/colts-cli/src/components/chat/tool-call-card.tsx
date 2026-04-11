/**
 * @fileoverview 工具调用展示卡片 — 工具名 + 参数 + 结果
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * 工具调用数据
 */
export interface ToolCallData {
  /** 工具名 */
  tool: string;
  /** 调用参数（JSON 字符串或对象） */
  args?: unknown;
  /** 工具执行结果 */
  result?: unknown;
  /** 是否正在执行 */
  isRunning?: boolean;
}

/**
 * ToolCallCard props
 */
interface ToolCallCardProps {
  /** 工具调用数据 */
  data: ToolCallData;
}

/**
 * 截断文本到指定长度
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * 格式化参数/结果为可读字符串
 */
function formatValue(value: unknown, maxLen = 80): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return truncate(str, maxLen);
}

/**
 * 工具调用卡片组件
 *
 * 显示工具名、参数摘要和执行结果。
 * isRunning 时显示 Spinner 文字。
 */
export function ToolCallCard({ data }: ToolCallCardProps) {
  return (
    <Box
      flexDirection="column"
      marginLeft={2}
      borderStyle="round"
      borderColor={theme.tool}
      paddingX={1}
    >
      <Box>
        <Text color={theme.tool}>{'>'} </Text>
        <Text bold color={theme.tool}>
          {data.tool}
        </Text>
        {data.isRunning && <Text color={theme.warning}> running...</Text>}
      </Box>
      {data.args !== undefined && (
        <Text color={theme.dim}>{formatValue(data.args)}</Text>
      )}
      {data.result !== undefined && (
        <Box>
          <Text color={theme.success}>{'= '}</Text>
          <Text color={theme.dim}>{formatValue(data.result)}</Text>
        </Box>
      )}
    </Box>
  );
}
