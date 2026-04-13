/**
 * @fileoverview Core sub-agent type definitions
 */
import type { AgentConfig, AgentState } from '../types.js';

/**
 * Sub-agent configuration
 */
export interface SubAgentConfig {
  /** Sub-agent name */
  name: string;
  /** Description (used by parent agent to decide when to delegate) */
  description: string;
  /** AgentConfig (independent instructions and tools) */
  config: AgentConfig;
  /** Max steps limit for sub-agent (default: 10) */
  maxSteps?: number;
  /** Allow this sub-agent to delegate further (default: false) */
  allowDelegation?: boolean;
}

/**
 * Delegate tool result
 */
export interface DelegateResult {
  /** Sub-agent's final answer */
  answer: string;
  /** Total steps executed by sub-agent */
  totalSteps: number;
  /** Sub-agent's final state (null for unknown sub-agents) */
  finalState: AgentState | null;
}

/**
 * Sub-agent streaming event types
 */
export type SubAgentStreamEvent =
  | { type: 'subagent:start'; name: string; task: string }
  | { type: 'subagent:end'; name: string; result: DelegateResult };
