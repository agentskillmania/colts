/**
 * @fileoverview Core sub-agent type definitions
 */
import { AgentRunner } from '../runner/index.js';
import type {
  AgentConfig,
  AgentState,
  ILLMProvider,
  IToolRegistry,
  ISkillProvider,
} from '../types.js';

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
  /** Max steps limit for sub-agent (default: 500) */
  maxSteps?: number;
  /** Allow this sub-agent to delegate further (default: false) */
  allowDelegation?: boolean;
  /** Timeout in milliseconds — sub-agent is aborted if it exceeds this (default: no timeout) */
  timeout?: number;
  /**
   * Inherit the parent runner's full tool set (file_read, shell, web_search, ...).
   * The recursive `delegate` tool is always filtered out. Default: true.
   * Set to false to keep the sub-agent limited to its declared `config.tools`.
   */
  inheritParentTools?: boolean;
  /**
   * Inherit the parent runner's skill provider, which wires up the
   * `load_skill` tool on the sub-agent. Default: true.
   */
  inheritParentSkills?: boolean;
}

/**
 * Delegate tool result — discriminated union by status.
 * The parent agent receives this as the tool's return value and can
 * branch on status to decide retry/fallback/report.
 */
export type DelegateResult =
  | { status: 'success'; answer: string; totalSteps: number }
  | { status: 'max_steps'; lastAnswer: string; totalSteps: number }
  | { status: 'error'; error: string; totalSteps: number }
  | { status: 'abort'; totalSteps: number }
  | { status: 'timeout'; partialResult: string; totalSteps: number };

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
      /** Parent agent's model identifier */
      model?: string;
      /** Parent runner's skill provider — forwarded when the sub-agent inherits skills */
      skillProvider?: ISkillProvider;
    }
  ): AgentRunner;
}

/** Default max steps for a sub-agent when not specified in SubAgentConfig */
export const DEFAULT_SUBAGENT_MAX_STEPS = 500;

/**
 * Default sub-agent factory: creates a new AgentRunner per delegation
 */
export class DefaultSubAgentFactory implements ISubAgentFactory {
  /** Default max steps when SubAgentConfig.maxSteps is not set */
  private defaultMaxSteps: number;

  constructor(defaultMaxSteps = DEFAULT_SUBAGENT_MAX_STEPS) {
    this.defaultMaxSteps = defaultMaxSteps;
  }

  create(
    config: SubAgentConfig,
    parentContext: {
      llmProvider: ILLMProvider;
      toolRegistry: IToolRegistry;
      model?: string;
      skillProvider?: ISkillProvider;
    }
  ): AgentRunner {
    // Default-on inheritance matches the expectation that a sub-agent can
    // do real work (read files, run shell, etc.) without the caller having
    // to redeclare every tool per agent. Either flag can be opted out.
    const inheritTools = config.inheritParentTools !== false;
    const inheritSkills = config.inheritParentSkills !== false;

    let inheritedTools: import('../tools/registry.js').Tool<import('zod').ZodTypeAny>[] = [];
    if (inheritTools) {
      // `delegate` is filtered out to prevent infinite recursion — a sub-agent
      // cannot itself call delegate unless `allowDelegation` is set and the
      // parent factory re-adds it (not the default factory's job).
      const all = parentContext.toolRegistry.getAll?.() ?? [];
      inheritedTools = all.filter((t) => t.name !== 'delegate');
    }

    return new AgentRunner({
      model: parentContext.model ?? 'sub-agent',
      llmClient: parentContext.llmProvider,
      maxSteps: config.maxSteps ?? this.defaultMaxSteps,
      tools: inheritedTools,
      skillProvider: inheritSkills ? parentContext.skillProvider : undefined,
    });
  }
}
