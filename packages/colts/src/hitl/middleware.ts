/**
 * @fileoverview HITL Middleware — intercepts tool execution for non-blocking human input
 *
 * Intercepts at the executing-tool phase:
 * - ask_human tool → produces HumanRequest { type: 'question' }
 * - confirmed tools → produces HumanRequest { type: 'tool-confirm' }
 *
 * Returns an AdvanceResult with waiting-human phase, so step()/run() return cleanly.
 */

import type {
  AgentMiddleware,
  BeforeAdvanceContext,
  AdvanceHookReturn,
} from '../middleware/types.js';
import type { AdvanceResult, ExecutionState } from '../execution/index.js';
import type { HumanRequest, HumanQuestion } from './types.js';
import type { AgentState } from '../types.js';

export interface HitlMiddlewareOptions {
  /** Name of the ask_human tool (default: 'ask_human') */
  askHumanToolName?: string;
  /** Tools requiring human confirmation */
  confirmTools?: string[];
}

export class HitlMiddleware implements AgentMiddleware {
  readonly name = 'hitl';
  private readonly askHumanToolName: string;
  private readonly confirmTools: Set<string>;

  constructor(options: HitlMiddlewareOptions = {}) {
    this.askHumanToolName = options.askHumanToolName ?? 'ask_human';
    this.confirmTools = new Set(options.confirmTools ?? []);
  }

  async beforeAdvance(ctx: BeforeAdvanceContext): Promise<AdvanceHookReturn> {
    const { execState, state } = ctx;

    // Only intercept at executing-tool phase
    if (execState.phase.type !== 'executing-tool') return;

    const actions = execState.allActions ?? execState.phase.actions;
    if (!actions || actions.length === 0) return;

    const approvals = new Set(state.context.hitlApprovals ?? []);

    // Check each action for HITL needs (use first matching)
    for (const action of actions) {
      // Skip actions that have already been approved
      if (approvals.has(action.id)) continue;

      const request = this.checkAction(action.tool, action.arguments, action.id);
      if (request) {
        return {
          state,
          execState,
          stop: true,
          result: this.createWaitingResult(state, execState, request),
        };
      }
    }
  }

  private checkAction(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string
  ): HumanRequest | undefined {
    // AskHuman tool
    if (toolName === this.askHumanToolName) {
      const questions = (args.questions ?? []) as HumanQuestion[];
      return {
        type: 'question',
        questions,
        context: args.context as string | undefined,
        toolCallId,
      };
    }

    // Confirmed tool
    if (this.confirmTools.has(toolName)) {
      return {
        type: 'tool-confirm',
        toolName,
        args,
        toolCallId,
      };
    }

    return undefined;
  }

  private createWaitingResult(
    state: AgentState,
    execState: ExecutionState,
    request: HumanRequest
  ): AdvanceResult {
    return {
      state,
      execState,
      phase: { type: 'waiting-human', request },
      done: true,
    };
  }
}
