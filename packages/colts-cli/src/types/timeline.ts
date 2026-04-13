/**
 * @fileoverview Timeline data model — unified TUI display entry types
 *
 * All StreamEvent / RunStreamEvent are mapped to TimelineEntry,
 * then filtered by the rendering layer according to DetailLevel before being output to a single canvas.
 */

import type { StepResult, RunResult } from '@agentskillmania/colts';

/**
 * Display detail level
 *
 * - compact: user message + assistant reply + tool summary line
 * - detail: compact + step boundaries + tool arguments and full results
 * - verbose: detail + phase changes + real-time token stream + thought
 */
export type DetailLevel = 'compact' | 'detail' | 'verbose';

/**
 * Timeline entry — converted from StreamEvent / RunStreamEvent
 */
export type TimelineEntry =
  | { type: 'user'; id: string; content: string; timestamp: number }
  | {
      type: 'assistant';
      id: string;
      content: string;
      timestamp: number;
      /** Whether it is currently streaming output */
      isStreaming?: boolean;
    }
  | {
      type: 'tool';
      id: string;
      /** Tool name */
      tool: string;
      args?: unknown;
      result?: unknown;
      /** Whether the tool is currently executing */
      isRunning?: boolean;
      timestamp: number;
    }
  | { type: 'phase'; id: string; from: string; to: string; timestamp: number }
  | { type: 'thought'; id: string; content: string; timestamp: number }
  | {
      type: 'step-start';
      id: string;
      step: number;
      timestamp: number;
    }
  | {
      type: 'step-end';
      id: string;
      step: number;
      result: StepResult;
      timestamp: number;
    }
  | {
      type: 'run-complete';
      id: string;
      result: RunResult;
      timestamp: number;
    }
  | {
      type: 'compress';
      id: string;
      status: 'compressing' | 'compressed';
      summary?: string;
      removedCount?: number;
      timestamp: number;
    }
  | {
      type: 'skill';
      id: string;
      name: string;
      status: 'loading' | 'loaded';
      tokenCount?: number;
      timestamp: number;
    }
  | {
      type: 'subagent';
      id: string;
      name: string;
      task?: string;
      result?: unknown;
      status: 'start' | 'end';
      timestamp: number;
    }
  | { type: 'system'; id: string; content: string; timestamp: number }
  | { type: 'error'; id: string; message: string; timestamp: number };

/**
 * Which TimelineEntry types should be displayed at each DetailLevel
 *
 * true = show, false = hide
 */
export const VISIBILITY_MAP: Record<TimelineEntry['type'], Record<DetailLevel, boolean>> = {
  user: { compact: true, detail: true, verbose: true },
  assistant: { compact: true, detail: true, verbose: true },
  tool: { compact: true, detail: true, verbose: true },
  phase: { compact: false, detail: false, verbose: true },
  thought: { compact: false, detail: false, verbose: true },
  'step-start': { compact: false, detail: true, verbose: true },
  'step-end': { compact: false, detail: true, verbose: true },
  'run-complete': { compact: true, detail: true, verbose: true },
  compress: { compact: false, detail: true, verbose: true },
  skill: { compact: true, detail: true, verbose: true },
  subagent: { compact: true, detail: true, verbose: true },
  system: { compact: true, detail: true, verbose: true },
  error: { compact: true, detail: true, verbose: true },
};

/**
 * Determine whether an entry is visible at the given DetailLevel
 *
 * @param entry - Timeline entry
 * @param level - Display level
 * @returns Whether it should be rendered
 */
export function isVisible(entry: TimelineEntry, level: DetailLevel): boolean {
  return VISIBILITY_MAP[entry.type][level];
}

/**
 * Filter timeline entries, keeping only those visible at the given DetailLevel
 *
 * @param entries - All timeline entries
 * @param level - Display level
 * @returns Filtered list of entries
 */
export function filterByDetailLevel(entries: TimelineEntry[], level: DetailLevel): TimelineEntry[] {
  return entries.filter((entry) => isVisible(entry, level));
}
