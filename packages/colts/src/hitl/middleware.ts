/**
 * @fileoverview HITL Middleware — intercepts tool execution for non-blocking human input
 *
 * Intercepts at the executing-tool phase:
 * - confirmed tools → produces HumanRequest { type: 'tool-confirm' }
 *
 * Returns an AdvanceResult with waiting-human phase, so step()/run() return cleanly.
 *
 * ask_human is deliberately NOT intercepted here (single-track, R2P-108,
 * aligned with Rust a2d508d/9a2bcd3): whether an ask_human call suspends is
 * expressed by the tool itself via the typed ToolSuspensionError signal,
 * intercepted by the kernel's executing-tool handler — name-matching here
 * would be an implicit convention intercepting every tool named ask_human
 * whether or not it wants to suspend.
 */

import type { HumanRequest } from './types.js';
import type { AdvanceResult, ExecutionState } from '../execution/index.js';
import type {
  AgentMiddleware,
  BeforeAdvanceContext,
  AdvanceHookReturn,
} from '../middleware/types.js';
import type { AgentState } from '../types.js';

export interface HitlMiddlewareOptions {
  /** Tools requiring human confirmation */
  confirmTools?: string[];
}

export class HitlMiddleware implements AgentMiddleware {
  readonly name = 'hitl';
  private readonly confirmTools: Set<string>;

  constructor(options: HitlMiddlewareOptions = {}) {
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
      // Skip actions that have already been approved (hitlApprovals persists
      // with the session — a resumed run must not re-confirm the same call)
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
