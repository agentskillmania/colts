/**
 * @fileoverview Core sub-agent type definitions
 */
import type { AgentConfig, AgentState, ILLMProvider, IToolRegistry } from '../types.js';
import { AgentRunner } from '../runner.js';

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

/**
 * Factory interface for creating sub-agent runners
 *
 * Decouples delegate-tool.ts from hardcoded `new AgentRunner(...)`.
 * Custom implementations can pool runners, add middleware, or use
 * entirely different sub-agent creation strategies.
 */
export interface ISubAgentFactory {
  /**
   * Create a sub-agent runner
   *
   * @param config - Sub-agent configuration
   * @param parentContext - Parent's LLM provider and tool registry
   * @returns AgentRunner configured for the sub-agent
   */
  create(
    config: SubAgentConfig,
    parentContext: {
      llmProvider: ILLMProvider;
      toolRegistry: IToolRegistry;
    }
  ): AgentRunner;
}

/**
 * Default sub-agent factory: creates a new AgentRunner per delegation
 */
export class DefaultSubAgentFactory implements ISubAgentFactory {
  /** Default max steps when SubAgentConfig.maxSteps is not set */
  private defaultMaxSteps: number;

  constructor(defaultMaxSteps = 10) {
    this.defaultMaxSteps = defaultMaxSteps;
  }

  create(
    config: SubAgentConfig,
    parentContext: {
      llmProvider: ILLMProvider;
      toolRegistry: IToolRegistry;
    }
  ): AgentRunner {
    return new AgentRunner({
      model: 'sub-agent',
      llmClient: parentContext.llmProvider,
      maxSteps: config.maxSteps ?? this.defaultMaxSteps,
    });
  }
}
