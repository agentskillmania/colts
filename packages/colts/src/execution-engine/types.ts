/**
 * @fileoverview Execution Engine type definitions
 *
 * Defines the IPhaseHandler interface and PhaseHandlerContext.
 * Each phase of the ReAct cycle is handled by a dedicated handler,
 * registered with the PhaseRouter.
 */

import type { AgentState, ILLMProvider, IToolRegistry } from '../types.js';
import type { ExecutionState, AdvanceResult, AdvanceOptions } from '../execution.js';
import type { IMessageAssembler } from '../message-assembler/types.js';
import type { ISkillProvider } from '../skills/types.js';
import type { SubAgentConfig } from '../subagent/types.js';
import type { IToolSchemaFormatter } from '../tools/schema-formatter.js';
import type { IExecutionPolicy } from '../policy/types.js';

/**
 * Context passed to every IPhaseHandler
 *
 * Contains all dependencies a handler might need, decoupled
 * from the Runner's internal state.
 */
export interface PhaseHandlerContext {
  /** LLM provider for calling models */
  llmProvider: ILLMProvider;
  /** Tool registry for executing tools */
  toolRegistry: IToolRegistry;
  /** Message assembler for building LLM message arrays */
  messageAssembler: IMessageAssembler;
  /** Tool schema formatter for converting tools to LLM format */
  toolSchemaFormatter: IToolSchemaFormatter;
  /** Skill provider (optional, for skill-aware handlers) */
  skillProvider?: ISkillProvider;
  /** Sub-agent configuration map (optional) */
  subAgentConfigs?: Map<string, SubAgentConfig>;
  /** Execution policy for error handling decisions */
  executionPolicy: IExecutionPolicy;
  /** Runner-level configuration */
  options: {
    model: string;
    systemPrompt?: string;
    requestTimeout?: number;
    maxSteps?: number;
  };
}

/**
 * Interface for phase handlers in the ReAct execution cycle
 *
 * Each handler is responsible for advancing execution from one phase
 * to the next. Implementations are registered with PhaseRouter which
 * dispatches based on the current phase type.
 */
export interface IPhaseHandler {
  /**
   * Check if this handler can process the given phase type
   *
   * @param phaseType - The phase type string to check
   * @returns true if this handler handles the given phase
   */
  canHandle(phaseType: string): boolean;

  /**
   * Execute phase advancement logic
   *
   * @param ctx - Handler context with dependencies
   * @param state - Current agent state (immutable)
   * @param execState - Mutable execution state tracking current phase
   * @param toolRegistry - Optional tool registry override (per-step override)
   * @param options - Optional advance options (signal, etc.)
   * @returns Advance result with updated state and phase
   */
  execute(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): Promise<AdvanceResult> | AdvanceResult;
}
