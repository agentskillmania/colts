/**
 * @fileoverview Advance Phase Machine
 *
 * Delegates phase-by-phase advancement to the PhaseRouter.
 * The router dispatches to registered IPhaseHandler instances.
 */

import type { AgentState, ILLMProvider, IToolRegistry } from './types.js';
import type { ISkillProvider } from './skills/types.js';
import type { SubAgentConfig } from './subagent/types.js';
import type { AdvanceResult, ExecutionState, AdvanceOptions } from './execution.js';
import type { IMessageAssembler } from './message-assembler/types.js';
import type { IPhaseHandler } from './execution-engine/types.js';
import { PhaseRouter } from './execution-engine/router.js';
import { createDefaultPhaseHandlers } from './execution-engine/default-registry.js';

/**
 * Runner context passed to extracted functions instead of `this`
 */
export interface RunnerContext {
  llmProvider: ILLMProvider;
  toolRegistry: IToolRegistry;
  /** Message assembler for building LLM message arrays */
  messageAssembler: IMessageAssembler;
  /** Phase router for dispatching to phase handlers */
  phaseRouter: PhaseRouter;
  skillProvider?: ISkillProvider;
  /** Sub-agent configuration map (name → SubAgentConfig) */
  subAgentConfigs?: Map<string, SubAgentConfig>;
  options: {
    model: string;
    systemPrompt?: string;
    requestTimeout?: number;
    maxSteps?: number;
  };
}

/** Module-level default PhaseRouter (shared, lazy-initialized) */
let _defaultRouter: PhaseRouter | null = null;

/**
 * Create the default PhaseRouter with all 10 standard handlers.
 * Returns a singleton to avoid repeated handler instantiation.
 *
 * @param customHandlers - Optional custom handler list (overrides defaults)
 * @returns PhaseRouter instance
 */
export function createRouter(customHandlers?: IPhaseHandler[]): PhaseRouter {
  if (customHandlers) {
    return new PhaseRouter(customHandlers);
  }
  if (!_defaultRouter) {
    _defaultRouter = new PhaseRouter(createDefaultPhaseHandlers());
  }
  return _defaultRouter;
}

/**
 * Execute one phase advancement
 *
 * Delegates to PhaseRouter for phase dispatching.
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @param execState - Execution state tracking current phase
 * @param toolRegistry - Optional tool registry override
 * @param options - Optional advance options
 * @returns Updated state, current phase, and completion status
 */
export async function executeAdvance(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  toolRegistry?: IToolRegistry,
  options?: AdvanceOptions
): Promise<AdvanceResult> {
  try {
    return await ctx.phaseRouter.execute(ctx, state, execState, toolRegistry, options);
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    execState.phase = { type: 'error', error: errorObj };
    return { state, phase: execState.phase, done: true };
  }
}

/**
 * Get RunnerContext-compatible message builder (for use by stream/run modules)
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @returns Array of messages formatted for pi-ai LLM calls
 * @internal
 */
export function buildMessagesFromCtx(
  ctx: RunnerContext,
  state: AgentState
): import('@mariozechner/pi-ai').Message[] {
  return ctx.messageAssembler.build(state, {
    systemPrompt: ctx.options.systemPrompt,
    model: ctx.options.model,
    skillProvider: ctx.skillProvider,
    subAgentConfigs: ctx.subAgentConfigs,
  });
}
