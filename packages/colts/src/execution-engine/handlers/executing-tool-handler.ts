/**
 * @fileoverview Executing-Tool Phase Handler
 *
 * Executes tool actions in parallel via Promise.all, processes skill
 * signals, writes tool messages to state. Transitions to tool-result phase.
 *
 * Also intercepts the typed HITL suspension signal (ToolSuspensionError)
 * before the error policy: a suspending run writes no tool results, the
 * unanswered requests are persisted in `context.pendingInterrupts` and the
 * advance ends in the waiting-human phase (R2P-108).
 */

import type {
  ExecutionState,
  AdvanceResult,
  AdvanceOptions,
  Action,
} from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';
import { upsertPendingInterrupt, retargetToolCallId } from '../../hitl/interrupts.js';
import type { HumanRequest } from '../../hitl/types.js';
import { formatSkillToolResult } from '../../skills/signal-handler.js';
import { isSkillSignal, type SkillSignal } from '../../skills/types.js';
import { addToolMessage, addUserMessage, incrementStepCount } from '../../state/index.js';
import { ToolSuspensionError } from '../../tools/registry.js';
import type { AgentState, IToolRegistry } from '../../types.js';
import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';

/** Per-action outcome: a normal result, or a typed HITL suspension request. */
type ActionOutcome =
  | { kind: 'ok'; action: Action; result: unknown }
  | { kind: 'suspend'; action: Action; request: HumanRequest };

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
    const outcomes = await Promise.all(
      actions.map(async (action): Promise<ActionOutcome> => {
        try {
          const result = await toolRegistry.execute(action.tool, action.arguments, {
            signal: options?.signal,
          });
          return { kind: 'ok', action, result };
        } catch (error) {
          // HITL suspension: the tool requests the run to pause and wait
          // for human input (typed control signal, NOT a failure). Anchor
          // the request to action.id (the LLM's tool_call id) so the future
          // answered tool-result message pairs with the assistant row —
          // intercepted here, before the error policy.
          if (error instanceof ToolSuspensionError) {
            return {
              kind: 'suspend',
              action,
              request: retargetToolCallId(error.request, action.id),
            };
          }
          const err = error instanceof Error ? error : new Error(String(error));
          // Delegate error handling to execution policy
          const decision = await ctx.executionPolicy.onToolError(err, action, state, {
            retryCount: 0,
          });
          if (decision.decision === 'continue') {
            return { kind: 'ok', action, result: decision.sanitizedResult };
          }
          // decision === 'fail': re-throw to propagate up
          throw decision.error;
        }
      })
    );

    // HITL suspension terminal state: no tool results are written (the
    // questions have no answers yet); every request is persisted in
    // pendingInterrupts (survives round switches / restarts) and the first
    // request takes the waiting-human phase. Parallel double-ask: all
    // requests enter the list, each paired with its own action id.
    const suspends = outcomes.filter(
      (o): o is Extract<ActionOutcome, { kind: 'suspend' }> => o.kind === 'suspend'
    );
    if (suspends.length > 0) {
      let suspended = state;
      for (const { request } of suspends) {
        suspended = upsertPendingInterrupt(suspended, request);
      }
      const first = suspends[0].request;
      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'waiting-human', request: first };
      });
      return { state: suspended, execState: nextExec, phase: nextExec.phase, done: true };
    }

    const results = outcomes.filter(
      (o): o is Extract<ActionOutcome, { kind: 'ok' }> => o.kind === 'ok'
    );

    // Aggregate results into Record<toolCallId, result>
    const resultMap: Record<string, unknown> = {};
    for (const { action, result } of results) {
      resultMap[action.id] = result;
    }

    const toolResult = results[0]?.result;

    // Write individual tool messages for each action.
    // For skill signals the persisted tool-result content is produced by
    // formatSkillToolResult (the single source of truth): for SWITCH_SKILL it
    // is the skill instructions, so the skill text persists in conversation
    // history across turns and context switches.
    let newState = state;
    for (const { action, result } of results) {
      const toolResultContent = formatSkillToolResult(result);
      newState = addToolMessage(newState, toolResultContent, {
        toolCallId: action.id,
        toolName: action.tool,
      });
    }
    newState = incrementStepCount(newState);

    const nextExec = updateExecState(execState, (draft) => {
      draft.toolResult = toolResult;
      draft.phase = { type: 'tool-result', results: resultMap };
    });

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
        return { state: withTask, execState: nextExec, phase: nextExec.phase, done: false };
      }
    }

    return { state: newState, execState: nextExec, phase: nextExec.phase, done: false };
  }
}
