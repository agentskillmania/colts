/**
 * @fileoverview 时间线数据模型 — 统一的 TUI 展示条目类型
 *
 * 所有 StreamEvent / RunStreamEvent 都映射为 TimelineEntry，
 * 再由渲染层按 DetailLevel 过滤后输出到单画布。
 */

import type { StepResult, RunResult } from '@agentskillmania/colts';

/**
 * 展示详细程度
 *
 * - compact: 用户消息 + 助手回复 + 工具摘要行
 * - detail: compact + 步骤边界 + 工具参数和完整结果
 * - verbose: detail + phase 变化 + 实时 token 流 + thought
 */
export type DetailLevel = 'compact' | 'detail' | 'verbose';

/**
 * 时间线条目 — 由 StreamEvent / RunStreamEvent 转换而来
 */
export type TimelineEntry =
  | { type: 'user'; id: string; content: string; timestamp: number }
  | {
      type: 'assistant';
      id: string;
      content: string;
      timestamp: number;
      /** 是否正在流式输出 */
      isStreaming?: boolean;
    }
  | {
      type: 'tool';
      id: string;
      /** 工具名称 */
      tool: string;
      args?: unknown;
      result?: unknown;
      /** 工具是否正在执行 */
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
 * 各 DetailLevel 下哪些 TimelineEntry 类型需要展示
 *
 * true = 显示，false = 隐藏
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
 * 判断条目在指定 DetailLevel 下是否可见
 *
 * @param entry - 时间线条目
 * @param level - 展示级别
 * @returns 是否应该渲染
 */
export function isVisible(entry: TimelineEntry, level: DetailLevel): boolean {
  return VISIBILITY_MAP[entry.type][level];
}

/**
 * 过滤时间线条目，只保留在指定 DetailLevel 下可见的条目
 *
 * @param entries - 全部时间线条目
 * @param level - 展示级别
 * @returns 过滤后的条目列表
 */
export function filterByDetailLevel(entries: TimelineEntry[], level: DetailLevel): TimelineEntry[] {
  return entries.filter((entry) => isVisible(entry, level));
}
