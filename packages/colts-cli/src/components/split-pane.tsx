/**
 * @fileoverview SplitPane — 分割面板组件
 *
 * 将终端区域分为上下两个面板，支持自定义比例和标题。
 * 用于同时展示聊天面板和事件面板。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';

/**
 * SplitPane 属性
 */
interface SplitPaneProps {
  /** 上方面板内容 */
  top: React.ReactNode;
  /** 下方面板内容 */
  bottom: React.ReactNode;
  /** 上方面板标题 */
  topTitle?: string;
  /** 下方面板标题 */
  bottomTitle?: string;
  /** 上方面板占比（0-1，默认 0.6） */
  topRatio?: number;
}

/**
 * 分割面板组件
 *
 * 将显示区域分为上下两部分，各自带有标题栏和边框。
 * 常用于同时展示聊天区域和事件日志区域。
 *
 * @param props - 组件属性
 * @returns 渲染的分割面板
 *
 * @example
 * ```tsx
 * <SplitPane
 *   topTitle="Chat"
 *   bottomTitle="Events"
 *   top={<Chat messages={messages} />}
 *   bottom={<Events events={events} />}
 * />
 * ```
 */
export function SplitPane({
  top,
  bottom,
  topTitle,
  bottomTitle,
}: SplitPaneProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* 上方面板 */}
      <Box flexDirection="column" flexGrow={1}>
        {topTitle && (
          <Box>
            <Text color={theme.info} bold>
              ── {topTitle} ──
            </Text>
          </Box>
        )}
        <Box flexDirection="column" flexGrow={1}>
          {top}
        </Box>
      </Box>

      {/* 分割线 */}
      <Box>
        <Text color={theme.dim}>{'─'.repeat(40)}</Text>
      </Box>

      {/* 下方面板 */}
      <Box flexDirection="column" flexGrow={1}>
        {bottomTitle && (
          <Box>
            <Text color={theme.info} bold>
              ── {bottomTitle} ──
            </Text>
          </Box>
        )}
        <Box flexDirection="column" flexGrow={1}>
          {bottom}
        </Box>
      </Box>
    </Box>
  );
}
