/**
 * @fileoverview Parsed Phase Handler
 *
 * Transitions from parsed to either executing-tool (if action exists)
 * or completed (if no action). Writes thought+toolCalls message to
 * state when action exists, or final answer when no action.
 *
 * Migrated from advanceToParsed() + advanceFromParsed() in runner-advance.ts.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult } from '../../execution.js';
import { addAssistantMessage, incrementStepCount } from '../../state.js';

export class ParsedHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'parsed';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    // Action already extracted from raw response in CallingLLMHandler
    const thought = execState.llmResponse ?? '';
    execState.thought = thought;

    if (execState.action) {
      // Has action: write thought message, transition to executing-tool
      const toolCalls = execState.allActions?.map((a) => ({
        id: a.id,
        name: a.tool,
        arguments: a.arguments,
      }));
      const newState = addAssistantMessage(state, thought, {
        type: 'thought',
        toolCalls,
      });
      execState.phase = { type: 'parsed', thought, action: execState.action };
      // Pass all actions to executing-tool phase for parallel execution
      const actions = execState.allActions ?? [execState.action];
      execState.phase = { type: 'executing-tool', actions };
      return { state: newState, phase: execState.phase, done: false };
    } else {
      // No action: go to completed with final answer
      const answer = thought;
      execState.phase = { type: 'completed', answer };
      const newState = incrementStepCount(addAssistantMessage(state, answer, { type: 'final' }));
      return { state: newState, phase: execState.phase, done: true };
    }
  }
}
