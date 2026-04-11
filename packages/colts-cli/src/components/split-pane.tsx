/**
 * @fileoverview SplitPane — Split pane component
 *
 * Splits the terminal area into top and bottom panels with customizable ratio and titles.
 * Used to display the chat panel and event panel simultaneously.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';

/**
 * SplitPane props
 */
interface SplitPaneProps {
  /** Top panel content */
  top: React.ReactNode;
  /** Bottom panel content */
  bottom: React.ReactNode;
  /** Top panel title */
  topTitle?: string;
  /** Bottom panel title */
  bottomTitle?: string;
  /** Top panel ratio (0-1, default 0.6) */
  topRatio?: number;
}

/**
 * Split pane component
 *
 * Splits the display area into top and bottom sections, each with a title bar and border.
 * Commonly used to show the chat area and event log area simultaneously.
 *
 * @param props - Component props
 * @returns Rendered split pane
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
      {/* Top panel */}
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

      {/* Divider line */}
      <Box>
        <Text color={theme.dim}>{'─'.repeat(40)}</Text>
      </Box>

      {/* Bottom panel */}
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
