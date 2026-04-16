/**
 * @fileoverview Executing-Tool Phase Handler
 *
 * Executes the current tool action, processes skill signals,
 * writes tool messages to state. Transitions to tool-result phase.
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState, IToolRegistry } from '../../types.js';
import type { ExecutionState, AdvanceResult, AdvanceOptions } from '../../execution.js';
import { isSkillSignal, type SkillSignal } from '../../skills/types.js';
import { addToolMessage, addUserMessage, incrementStepCount } from '../../state.js';

export class ExecutingToolHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'executing-tool';
  }

  async execute(
    _ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): Promise<AdvanceResult> {
    const action = execState.action;
    if (!action) {
      throw new Error('No action to execute');
    }
    if (!toolRegistry) {
      throw new Error('Tool registry is required for tool execution');
    }

    let result: unknown;
    try {
      result = await toolRegistry.execute(action.tool, action.arguments, {
        signal: options?.signal,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result = `Error: ${errorMessage}`;
    }

    execState.toolResult = result;
    execState.phase = { type: 'tool-result', result };

    // Format skill signals as LLM-friendly text instead of raw JSON
    let toolResultContent: string;
    if (isSkillSignal(result)) {
      const sig = result as SkillSignal;
      switch (sig.type) {
        case 'SWITCH_SKILL': {
          // Validate transition before writing optimistic message
          const ss = state.context.skillState;
          if (ss?.current === sig.to) {
            toolResultContent = `Skill '${sig.to}' is already active. Continue with current instructions.`;
          } else if (ss?.stack.some((f) => f.skillName === sig.to)) {
            toolResultContent = `Cannot load Skill '${sig.to}': already in the call stack. Continue with current task.`;
          } else {
            toolResultContent = `Skill '${sig.to}' loaded. Follow its instructions.`;
          }
          break;
        }
        case 'RETURN_SKILL':
          toolResultContent =
            typeof sig.result === 'string' ? sig.result : JSON.stringify(sig.result);
          break;
        case 'SKILL_NOT_FOUND':
          toolResultContent = `Skill '${sig.requested}' not found. Available: ${sig.available.join(', ')}`;
          break;
        default:
          toolResultContent = JSON.stringify(result);
      }
    } else {
      toolResultContent = typeof result === 'string' ? result : JSON.stringify(result);
    }
    const newState = incrementStepCount(
      addToolMessage(state, toolResultContent, {
        toolCallId: action.id,
        toolName: action.tool,
      })
    );

    // Inject task instruction as a user message on skill switch (always injected)
    if (isSkillSignal(result)) {
      const sig = result as SkillSignal;
      if (sig.type === 'SWITCH_SKILL') {
        const task = (sig as SkillSignal & { task?: string }).task;
        const instruction =
          task && task !== 'Execute as instructed'
            ? task
            : 'Follow the loaded skill instructions to complete the user request.';
        const withTask = addUserMessage(newState, instruction);
        return { state: withTask, phase: execState.phase, done: false };
      }
    }

    return { state: newState, phase: execState.phase, done: false };
  }
}
