/**
 * @fileoverview Subagent 核心类型定义
 */
import type { AgentConfig, AgentState } from '../types.js';

/**
 * 子 agent 配置
 */
export interface SubAgentConfig {
  /** 子 agent 名称 */
  name: string;
  /** 描述（主 agent 用来判断什么时候委派） */
  description: string;
  /** AgentConfig（独立的 instructions、tools） */
  config: AgentConfig;
  /** 限制子 agent 的 maxSteps（默认 10） */
  maxSteps?: number;
  /** 是否允许此子 agent 再次委派（默认 false） */
  allowDelegation?: boolean;
}

/**
 * delegate tool 的结果
 */
export interface DelegateResult {
  /** 子 agent 的最终答案 */
  answer: string;
  /** 子 agent 执行的总步数 */
  totalSteps: number;
  /** 子 agent 的最终状态 */
  finalState: AgentState;
}

/**
 * Subagent 流式事件类型
 */
export type SubAgentStreamEvent =
  | { type: 'subagent:start'; name: string; task: string }
  | { type: 'subagent:token'; name: string; token: string }
  | { type: 'subagent:step:end'; name: string; step: number }
  | { type: 'subagent:end'; name: string; result: DelegateResult };
