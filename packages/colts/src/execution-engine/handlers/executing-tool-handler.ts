/**
 * @fileoverview Executing-Tool Phase Handler
 *
 * Executes tool actions in parallel via Promise.all, processes skill
 * signals, writes tool messages to state. Transitions to tool-result phase.
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
    ctx: PhaseHandlerContext,
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): Promise<AdvanceResult> {
    const phase = execState.phase;
    if (phase.type !== 'executing-tool') {
      throw new Error('Unexpected phase type');
    }

    const actions = phase.actions;
    if (actions.length === 0) {
      throw new Error('No actions to execute');
    }
    if (!toolRegistry) {
      throw new Error('Tool registry is required for tool execution');
    }

    // Execute all tool calls in parallel
    const results = await Promise.all(
      actions.map(async (action) => {
        try {
          const result = await toolRegistry.execute(action.tool, action.arguments, {
            signal: options?.signal,
          });
          return { action, result, error: false };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          // Delegate error handling to execution policy
          const decision = await ctx.executionPolicy.onToolError(err, action, state, {
            retryCount: 0,
          });
          if (decision.decision === 'continue') {
            return { action, result: decision.sanitizedResult, error: false };
          }
          // decision === 'fail': re-throw to propagate up
          throw decision.error;
        }
      })
    );

    // Aggregate results into Record<toolCallId, result>
    const resultMap: Record<string, unknown> = {};
    for (const { action, result } of results) {
      resultMap[action.id] = result;
    }

    // Backward compat: execState.action takes the first, execState.toolResult takes the first result
    execState.toolResult = results[0]?.result;

    execState.phase = { type: 'tool-result', results: resultMap };

    // Write individual tool messages for each action
    let newState = state;
    for (const { action, result } of results) {
      const toolResultContent = formatToolResult(result);
      newState = addToolMessage(newState, toolResultContent, {
        toolCallId: action.id,
        toolName: action.tool,
      });
    }
    newState = incrementStepCount(newState);

    // Skill signal: only check on the first result
    // Models should not mix skill calls with plain tool calls in one batch
    const firstResult = results[0]?.result;
    const firstAction = results[0]?.action;
    if (isSkillSignal(firstResult) && firstAction) {
      const sig = firstResult as SkillSignal;
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

/**
 * Format tool result as string.
 * Skill signals get special formatting; plain results are serialized directly.
 */
function formatToolResult(result: unknown): string {
  if (isSkillSignal(result)) {
    const sig = result as SkillSignal;
    switch (sig.type) {
      case 'SWITCH_SKILL':
        return `Skill '${sig.to}' loaded. Follow its instructions.`;
      case 'RETURN_SKILL':
        return typeof sig.result === 'string' ? sig.result : JSON.stringify(sig.result);
      case 'SKILL_NOT_FOUND':
        return `Skill '${sig.requested}' not found. Available: ${sig.available.join(', ')}`;
      default:
        return JSON.stringify(result);
    }
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}
