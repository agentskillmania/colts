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
  | {
      /** Entry type */
      type: 'user';
      /** Unique entry identifier */
      id: string;
      /** User message content */
      content: string;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'assistant';
      /** Unique entry identifier */
      id: string;
      /** Assistant message content */
      content: string;
      /** Timestamp in milliseconds */
      timestamp: number;
      /** Whether it is currently streaming output */
      isStreaming?: boolean;
    }
  | {
      /** Entry type */
      type: 'tool';
      /** Unique entry identifier */
      id: string;
      /** Tool name */
      tool: string;
      /** Tool arguments */
      args?: unknown;
      /** Tool execution result */
      result?: unknown;
      /** Whether the tool is currently executing */
      isRunning?: boolean;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'phase';
      /** Unique entry identifier */
      id: string;
      /** Previous phase name */
      from: string;
      /** Next phase name */
      to: string;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'thought';
      /** Unique entry identifier */
      id: string;
      /** Thought content */
      content: string;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'step-start';
      /** Unique entry identifier */
      id: string;
      /** Step number */
      step: number;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'step-end';
      /** Unique entry identifier */
      id: string;
      /** Step number */
      step: number;
      /** Step execution result */
      result: StepResult;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'run-complete';
      /** Unique entry identifier */
      id: string;
      /** Run execution result */
      result: RunResult;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'compress';
      /** Unique entry identifier */
      id: string;
      /** Compression status */
      status: 'compressing' | 'compressed';
      /** Compression summary text */
      summary?: string;
      /** Number of removed messages */
      removedCount?: number;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'skill';
      /** Unique entry identifier */
      id: string;
      /** Skill name */
      name: string;
      /** Skill loading status */
      status: 'loading' | 'loaded' | 'active' | 'completed';
      /** Loaded token count */
      tokenCount?: number;
      /** Skill execution result (present when status is 'completed') */
      result?: string;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'subagent';
      /** Unique entry identifier */
      id: string;
      /** SubAgent name */
      name: string;
      /** Task description */
      task?: string;
      /** SubAgent result */
      result?: unknown;
      /** SubAgent execution status */
      status: 'start' | 'end';
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'system';
      /** Unique entry identifier */
      id: string;
      /** System message content */
      content: string;
      /** Timestamp in milliseconds */
      timestamp: number;
    }
  | {
      /** Entry type */
      type: 'error';
      /** Unique entry identifier */
      id: string;
      /** Error message */
      message: string;
      /** Timestamp in milliseconds */
      timestamp: number;
    };

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
