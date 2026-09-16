/**
 * @fileoverview Executing-Tool Phase Handler
 *
 * Executes tool actions in parallel via allSettled-style collection,
 * processes skill signals, writes tool messages to state. Transitions to
 * tool-result phase.
 *
 * Also intercepts the typed HITL suspension signal (ToolSuspensionError)
 * before the error policy: executed siblings' tool results are still
 * recorded (side effects already happened — dropping them leaves dangling
 * toolCalls that providers reject with 400 on resume), the suspended
 * requests are persisted in `context.pendingInterrupts` (all of them,
 * surfaced via the phase's `requests` array) and the advance ends in the
 * waiting-human phase (R2P-108 + 返修).
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
import {
  addToolMessage,
  addUserMessage,
  incrementStepCount,
  updateState,
} from '../../state/index.js';
import { ToolSuspensionError } from '../../tools/registry.js';
import type { AgentState, IToolRegistry } from '../../types.js';
import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';

/** Per-action outcome: a normal result, or a typed HITL suspension request. */
type ActionOutcome =
  | { kind: 'ok'; action: Action; result: unknown }
  | { kind: 'suspend'; action: Action; request: HumanRequest };

/** Recognize a suspension signal; `undefined` when the error is not one. */
function toSuspensionRequest(error: unknown): HumanRequest | undefined {
  // instanceof is the primary check; the name-tagged fallback survives a
  // dual-package scenario (two copies of the class → instanceof silently
  // degrades the signal to a plain tool failure). A name match without the
  // request payload is not a suspension — treated as a normal error below.
  if (error instanceof ToolSuspensionError) return error.request;
  if ((error as { name?: string } | null | undefined)?.name === 'ToolSuspensionError') {
    const request = (error as { request?: HumanRequest }).request;
    if (request) return request;
  }
  return undefined;
}

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

    // Execute all tool calls in parallel. allSettled-style collection: a
    // sibling's fail decision must not silently swallow suspends collected
    // by other actions of the same batch (the human's question outranks a
    // race-decided tool error). Rejections here carry policy-'fail' errors.
    const settled = await Promise.allSettled(
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
          const suspendRequest = toSuspensionRequest(error);
          if (suspendRequest) {
            return {
              kind: 'suspend',
              action,
              request: retargetToolCallId(suspendRequest, action.id),
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
          // decision === 'fail': reject to propagate up (collected below)
          throw decision.error;
        }
      })
    );

    const oks = settled
      .filter(
        (s): s is PromiseFulfilledResult<Extract<ActionOutcome, { kind: 'ok' }>> =>
          s.status === 'fulfilled' && s.value.kind === 'ok'
      )
      .map((s) => s.value);
    const suspends = settled
      .filter(
        (s): s is PromiseFulfilledResult<Extract<ActionOutcome, { kind: 'suspend' }>> =>
          s.status === 'fulfilled' && s.value.kind === 'suspend'
      )
      .map((s) => s.value);
    const failures = settled
      .map((s, i) => ({ settled: s, action: actions[i] }))
      .filter(
        (x): x is { settled: PromiseRejectedResult; action: Action } =>
          x.settled.status === 'rejected'
      )
      .map(({ settled: s, action }) => ({ action, error: s.reason as Error }));

    // Executed siblings' durable record — write tool messages for every ok
    // result even when the advance ends suspended: the side effects already
    // happened, and a missing tool result leaves a dangling toolCall the
    // provider rejects with 400 ("tool_call_ids did not have response
    // messages") on resume. For skill signals the persisted tool-result
    // content is produced by formatSkillToolResult (single source of truth).
    let newState = state;
    for (const { action, result } of oks) {
      const toolResultContent = formatSkillToolResult(result);
      newState = addToolMessage(newState, toolResultContent, {
        toolCallId: action.id,
        toolName: action.tool,
      });
    }
    if (oks.length > 0) {
      newState = incrementStepCount(newState);
    }

    // HITL suspension terminal state: suspends outrank fail terminals (and
    // any collected suspends are persisted even when a sibling failed).
    // No tool results are written for the suspended calls (the questions
    // have no answers yet); every request is persisted in pendingInterrupts
    // (survives round switches / restarts). Parallel double-ask: all
    // requests enter the list AND the phase's `requests` array (the host
    // must see everything it has to answer), first takes `request`.
    if (suspends.length > 0) {
      for (const { request } of suspends) {
        newState = upsertPendingInterrupt(newState, request);
      }
      // A custom fail policy can reject one action while a sibling suspends:
      // the suspension terminal still outranks the fail, but the failed call
      // must leave a durable record. Without one its tool_call stays
      // unpaired once the human answers, and run()'s resume guard would then
      // refuse the resume (the provider would reject it with 400). Written
      // in the rejectTool shape (isError tool message) so the durable record
      // matches a human rejection. Unreachable under the default policy
      // (onToolError never decides 'fail') — defensive for custom policies.
      // (R2P-108 review P3.)
      for (const { action, error } of failures) {
        newState = addToolMessage(newState, `Tool execution failed: ${error.message}`, {
          toolCallId: action.id,
          toolName: action.tool,
          isError: true,
        });
      }
      const requests = suspends.map((s) => s.request);
      const nextExec = updateExecState(execState, (draft) => {
        draft.phase = { type: 'waiting-human', request: requests[0], requests };
        // The tool-result phase's `results` map is unreachable from a
        // terminal waiting-human phase (execState is per-run ephemeral);
        // the durable per-action record is the tool messages in history.
        // Keep the primary toolResult field populated for observability.
        if (oks.length > 0) draft.toolResult = oks[0].result;
      });
      return { state: newState, execState: nextExec, phase: nextExec.phase, done: true };
    }

    // No suspends: a collected fail propagates (first failure, matching
    // Promise.all's first-rejection semantics).
    if (failures.length > 0) {
      throw failures[0].error;
    }

    // Aggregate results into Record<toolCallId, result>
    const resultMap: Record<string, unknown> = {};
    for (const { action, result } of oks) {
      resultMap[action.id] = result;
    }

    const toolResult = oks[0]?.result;

    const nextExec = updateExecState(execState, (draft) => {
      draft.toolResult = toolResult;
      draft.phase = { type: 'tool-result', results: resultMap };
    });

    // Skill signal: only check on the first result
    // Models should not mix skill calls with plain tool calls in one batch
    const firstResult = oks[0]?.result;
    const firstAction = oks[0]?.action;
    if (isSkillSignal(firstResult) && firstAction) {
      const sig = firstResult as SkillSignal;
      if (sig.type === 'SWITCH_SKILL') {
        const task = (sig as SkillSignal & { task?: string }).task;
        const instruction =
          task && task !== 'Execute as instructed'
            ? task
            : 'Follow the loaded skill instructions to complete the user request.';
        // Tag the injected row as a skill directive: assembly is by role, so
        // the LLM still receives a plain user message (zero model-side
        // change); the history rebuild (frontend fromHistory) uses the
        // marker to skip bubble rendering — the line is not a real user
        // utterance and must not cut the assistant turn (live/resume
        // isomorphism). (R2P-114, aligned with Rust 87a54aa.)
        const withTask = tagSkillDirective(addUserMessage(newState, instruction));
        return { state: withTask, execState: nextExec, phase: nextExec.phase, done: false };
      }
    }

    return { state: newState, execState: nextExec, phase: nextExec.phase, done: false };
  }
}

/**
 * Tag the just-injected trailing user message as a skill directive.
 *
 * Private to this handler (zero public state-surface increment, mirroring
 * Rust's `tag_last_user_message`): addUserMessage without a length limit
 * never throws, so the last row is always the just-injected directive; the
 * role guard only defends the invariant. If the invariant is ever violated
 * the row stays untagged (a phantom user utterance the history rebuild will
 * render as a real user bubble), so warn instead of failing silently.
 * (R2P-114, aligned with Rust 87a54aa; review P3.)
 */
function tagSkillDirective(state: AgentState): AgentState {
  return updateState(state, (draft) => {
    const last = draft.context.messages[draft.context.messages.length - 1];
    if (last && last.role === 'user') {
      last.type = 'skill-directive';
    } else {
      console.warn(
        '[colts] tagSkillDirective: last history row is not a user message ' +
          `(role=${last?.role ?? 'none'}) — the skill directive stays untagged; ` +
          'the history rebuild would render it as a phantom user utterance.'
      );
    }
  });
}
