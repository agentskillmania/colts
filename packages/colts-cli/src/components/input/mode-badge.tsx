/**
 * @fileoverview Mode badge component — displays the current execution mode
 */

import React from 'react';
import { Badge } from '@inkjs/ui';

/**
 * Execution mode type
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * ModeBadge props
 */
interface ModeBadgeProps {
  /** Current execution mode */
  mode: ExecutionMode;
}

/** Mode to color/label mapping */
const MODE_CONFIG: Record<ExecutionMode, { color: 'green' | 'yellow' | 'blue'; label: string }> = {
  run: { color: 'green', label: 'RUN' },
  step: { color: 'yellow', label: 'STEP' },
  advance: { color: 'blue', label: 'ADV' },
};

/**
 * Mode badge component
 *
 * Renders the current execution mode label using @inkjs/ui Badge.
 *
 * @param props - Component props
 */
export function ModeBadge({ mode }: ModeBadgeProps) {
  const config = MODE_CONFIG[mode];
  return <Badge color={config.color}>{config.label}</Badge>;
}
