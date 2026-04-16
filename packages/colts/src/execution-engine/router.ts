/**
 * @fileoverview Phase Router
 *
 * Dispatches execution to the appropriate IPhaseHandler based on
 * the current phase type. Replaces the monolithic switch-case in
 * runner-advance.ts.
 */

import type { IPhaseHandler, PhaseHandlerContext } from './types.js';
import type { AgentState, IToolRegistry } from '../types.js';
import type { ExecutionState, AdvanceResult, AdvanceOptions } from '../execution.js';

/**
 * Phase router that dispatches to registered handlers
 *
 * Maintains a map of phase type → IPhaseHandler. On each advance,
 * looks up the handler for the current phase type and delegates.
 */
export class PhaseRouter {
  private handlers = new Map<string, IPhaseHandler>();

  /**
   * Create a PhaseRouter with the given handlers
   *
   * @param handlers - Array of phase handlers to register
   */
  constructor(handlers: IPhaseHandler[]) {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  /**
   * Register a phase handler
   *
   * Infers the phase type from the handler's canHandle() method
   * by testing against known phase types.
   *
   * @param handler - Handler to register
   * @throws Error if the handler's phase type cannot be inferred
   */
  register(handler: IPhaseHandler): void {
    const knownTypes = [
      'idle',
      'preparing',
      'calling-llm',
      'llm-response',
      'parsing',
      'parsed',
      'executing-tool',
      'tool-result',
      'completed',
      'error',
    ];

    for (const type of knownTypes) {
      if (handler.canHandle(type)) {
        this.handlers.set(type, handler);
        return;
      }
    }
    throw new Error('Cannot infer phase type for handler');
  }

  /**
   * Execute the handler for the current phase
   *
   * @param ctx - Handler context with dependencies
   * @param state - Current agent state
   * @param execState - Execution state tracking current phase
   * @param toolRegistry - Optional tool registry override
   * @param options - Optional advance options
   * @returns Advance result from the matched handler, or error phase if no handler found
   */
  async execute(
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): Promise<AdvanceResult> {
    const handler = this.handlers.get(execState.phase.type);
    if (!handler) {
      const error = new Error(`No handler for phase: ${execState.phase.type}`);
      execState.phase = { type: 'error', error };
      return { state, phase: execState.phase, done: true };
    }
    return await handler.execute(ctx, state, execState, toolRegistry, options);
  }

  /**
   * Get a handler by phase type (for testing or custom dispatch)
   *
   * @param phaseType - Phase type to look up
   * @returns Handler or undefined
   */
  getHandler(phaseType: string): IPhaseHandler | undefined {
    return this.handlers.get(phaseType);
  }
}
