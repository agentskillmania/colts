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
 * 所有 entry 共享 seq 字段（全局单调递增序号），用于保证渲染顺序。
 * 即使 React 批量更新合并了中间状态，按 seq 排序后条目顺序始终正确。
 */
export type TimelineEntry =
  | {
      type: 'user';
      id: string;
      /** 全局单调递增序号，保证渲染顺序 */
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
      /** 工具执行耗时（毫秒） */
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
      /** Skill 任务描述 */
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
      /** 发送给 LLM 的消息数量 */
      messageCount: number;
      /** 可用工具列表 */
      tools: string[];
      /** 当前 skill 上下文 */
      skill: { current: string | null; stack: string[] } | null;
      timestamp: number;
    }
  | {
      type: 'llm-response';
      id: string;
      seq: number;
      /** LLM 返回的文本长度 */
      textLength: number;
      /** 工具调用列表 */
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
 * 全局 seq 计数器
 *
 * 保证所有 TimelineEntry 的 seq 单调递增，用于渲染排序。
 * 跨 StreamEventConsumer 和 useAgent 共享。
 */
let globalSeq = 0;

/**
 * 分配下一个 seq 序号
 *
 * @returns 单调递增的序号
 */
export function nextSeq(): number {
  return ++globalSeq;
}
