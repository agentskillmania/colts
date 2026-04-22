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
 *
 * All entries share the seq field (globally monotonically increasing number) to guarantee render order.
 * Even if React batch updates merge intermediate states, sorting by seq ensures correct entry order.
 */
export type TimelineEntry =
  | {
      type: 'user';
      id: string;
      /** Globally monotonically increasing number, guarantees render order */
      seq: number;
      content: string;
      timestamp: number;
    }
  | {
      type: 'assistant';
      id: string;
      seq: number;
      content: string;
      timestamp: number;
      isStreaming?: boolean;
    }
  | {
      type: 'tool';
      id: string;
      seq: number;
      tool: string;
      args?: unknown;
      result?: unknown;
      isRunning?: boolean;
      /** Tool execution duration (milliseconds) */
      duration?: number;
      timestamp: number;
    }
  | {
      type: 'phase';
      id: string;
      seq: number;
      from: string;
      to: string;
      timestamp: number;
    }
  | {
      type: 'thought';
      id: string;
      seq: number;
      content: string;
      timestamp: number;
    }
  | {
      type: 'step-start';
      id: string;
      seq: number;
      step: number;
      timestamp: number;
    }
  | {
      type: 'step-end';
      id: string;
      seq: number;
      step: number;
      result: StepResult;
      timestamp: number;
    }
  | {
      type: 'run-complete';
      id: string;
      seq: number;
      result: RunResult;
      timestamp: number;
    }
  | {
      type: 'compress';
      id: string;
      seq: number;
      status: 'compressing' | 'compressed';
      summary?: string;
      removedCount?: number;
      timestamp: number;
    }
  | {
      type: 'skill';
      id: string;
      seq: number;
      name: string;
      status: 'loading' | 'loaded' | 'active' | 'completed';
      tokenCount?: number;
      result?: string;
      /** Skill task description */
      task?: string;
      timestamp: number;
    }
  | {
      type: 'subagent';
      id: string;
      seq: number;
      name: string;
      task?: string;
      result?: unknown;
      status: 'start' | 'end';
      timestamp: number;
    }
  | {
      type: 'system';
      id: string;
      seq: number;
      content: string;
      timestamp: number;
    }
  | {
      type: 'error';
      id: string;
      seq: number;
      message: string;
      timestamp: number;
    }
  | {
      type: 'llm-request';
      id: string;
      seq: number;
      /** Number of messages sent to LLM */
      messageCount: number;
      /** Available tool list */
      tools: string[];
      /** Current skill context */
      skill: { current: string | null; stack: string[] } | null;
      timestamp: number;
    }
  | {
      type: 'llm-response';
      id: string;
      seq: number;
      /** Length of text returned by LLM */
      textLength: number;
      /** Tool call list */
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
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
  'llm-request': { compact: false, detail: false, verbose: true },
  'llm-response': { compact: false, detail: false, verbose: true },
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

/**
 * Global seq counter
 *
 * Ensures all TimelineEntry seq values monotonically increase, used for render sorting.
 * Shared across StreamEventConsumer and useAgent.
 */
let globalSeq = 0;

/**
 * Allocate next seq number
 *
 * @returns Monotonically increasing number
 */
export function nextSeq(): number {
  return ++globalSeq;
}
