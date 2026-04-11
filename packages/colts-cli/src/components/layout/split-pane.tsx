/**
 * @fileoverview Left-right split pane container — holds Chat and Events panels
 *
 * Horizontal split layout with a collapsible right panel. When collapsed, the left panel takes full width.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../utils/theme.js';

/**
 * SplitPane props
 */
interface SplitPaneProps {
  /** Left content (Chat panel) */
  left: React.ReactNode;
  /** Right content (Events panel) */
  right: React.ReactNode;
  /** Left panel title */
  leftTitle?: string;
  /** Right panel title */
  rightTitle?: string;
  /** Whether the right panel is visible */
  rightVisible?: boolean;
  /** Left panel width ratio (0-1, default 0.6) */
  leftRatio?: number;
}

/**
 * Left-right split pane container component
 *
 * Uses `flexDirection="row"` for horizontal splitting.
 * Controls right panel visibility via `rightVisible`.
 *
 * @param props - Component props
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
      {/* Left panel */}
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

      {/* Right panel (collapsible) */}
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
