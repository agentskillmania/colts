/**
 * @fileoverview 左右分屏容器 — Chat 和 Events 面板的容器
 *
 * 左右分屏布局，右侧面板可折叠。折叠后左侧占满宽度。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * SplitPane props
 */
interface SplitPaneProps {
  /** 左侧内容（Chat 面板） */
  left: React.ReactNode;
  /** 右侧内容（Events 面板） */
  right: React.ReactNode;
  /** 左侧标题 */
  leftTitle?: string;
  /** 右侧标题 */
  rightTitle?: string;
  /** 右侧面板是否可见 */
  rightVisible?: boolean;
  /** 左侧占比（0-1，默认 0.6） */
  leftRatio?: number;
}

/**
 * 左右分屏容器组件
 *
 * 使用 `flexDirection="row"` 实现水平分割。
 * 通过 `rightVisible` 控制右侧面板折叠。
 *
 * @param props - 组件属性
 */
export function SplitPane({
  left,
  right,
  leftTitle,
  rightTitle,
  rightVisible = true,
  leftRatio = 0.6,
}: SplitPaneProps) {
  const leftPct = `${Math.round(leftRatio * 100)}%`;
  const rightPct = `${Math.round((1 - leftRatio) * 100)}%`;

  return (
    <Box flexDirection="row" flexGrow={1}>
      {/* 左侧面板 */}
      <Box flexDirection="column" width={rightVisible ? leftPct : '100%'}>
        {leftTitle && (
          <Box>
            <Text color={theme.info} bold>
              {'── '}
              {leftTitle}
              {' ──'}
            </Text>
          </Box>
        )}
        <Box flexDirection="column" flexGrow={1}>
          {left}
        </Box>
      </Box>

      {/* 右侧面板（可折叠） */}
      {rightVisible && (
        <>
          <Box flexDirection="column" width={1}>
            <Text color={theme.dim}>{'│'}</Text>
          </Box>
          <Box flexDirection="column" width={rightPct}>
            {rightTitle && (
              <Box>
                <Text color={theme.info} bold>
                  {'── '}
                  {rightTitle}
                  {' ──'}
                </Text>
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1}>
              {right}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
