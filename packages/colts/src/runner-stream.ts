/**
 * @fileoverview Streaming Execution Helpers
 *
 * Handles streaming LLM response, advance streaming, and step streaming.
 * Extracted from AgentRunner for maintainability.
 */

import type { AgentState, IToolRegistry } from './types.js';
import { updateState } from './state.js';
import type {
  AdvanceResult,
  ExecutionState,
  StepResult,
  StreamEvent,
  AdvanceOptions,
} from './execution.js';
import { createExecutionState, isTerminalPhase } from './execution.js';
import type { RunnerContext } from './runner-advance.js';
import { executeAdvance } from './runner-advance.js';
import { buildMessagesFromCtx } from './runner-advance.js';
import { getToolsForLLM } from './runner-message-builder.js';
import { maybeCompress } from './runner-compression.js';
import type { IContextCompressor } from './types.js';
import { isSkillSignal, type SkillSignal } from './skills/types.js';

/**
 * Stream LLM response during calling-llm phase.
 *
 * Shared between advanceStream() and stepStream() to avoid duplicate logic.
 * Yields token events in real-time and stores the complete response in execState.
 */
export async function* streamCallingLLM(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  registry?: IToolRegistry,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const tools = getToolsForLLM(registry);
  let accumulatedContent = '';
  let responseContent = '';
  let responseToolCalls:
    | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    | undefined;

  for await (const event of ctx.llmProvider.stream({
    model: ctx.options.model,
    messages: execState.preparedMessages ?? buildMessagesFromCtx(ctx, state),
    tools,
    priority: 0,
    requestTimeout: ctx.options.requestTimeout,
    signal,
  })) {
    if (signal?.aborted) break;

    if (event.type === 'text') {
      accumulatedContent = event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');
      yield { type: 'token', token: event.delta ?? '' };
    } else if (event.type === 'tool_call' && event.toolCall) {
      responseToolCalls = responseToolCalls ?? [];
      responseToolCalls.push({
        id: event.toolCall.id,
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      });
    } else if (event.type === 'done') {
      responseContent = accumulatedContent;
    }
  }

  // Store complete response
  execState.llmResponse = responseContent;
  if (responseToolCalls && responseToolCalls.length > 0) {
    const toolCall = responseToolCalls[0];
    execState.action = {
      id: toolCall.id,
      tool: toolCall.name,
      arguments: toolCall.arguments,
    };
    execState.allActions = responseToolCalls.map((tc) => ({
      id: tc.id,
      tool: tc.name,
      arguments: tc.arguments,
    }));
  }
  execState.phase = { type: 'llm-response', response: responseContent };
}

/**
 * Stream phase advancement (micro-step streaming)
 */
export async function* executeAdvanceStream(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  toolRegistry?: IToolRegistry,
  options?: AdvanceOptions
): AsyncGenerator<StreamEvent, AdvanceResult> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  const fromPhase = execState.phase;

  // Handle streaming LLM response
  if (fromPhase.type === 'calling-llm') {
    yield { type: 'phase-change', from: fromPhase, to: { type: 'streaming' } };

    try {
      yield* streamCallingLLM(ctx, state, execState, registry, options?.signal);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      execState.phase = { type: 'error', error: errorObj };
      yield { type: 'error', error: errorObj, context: { step: 0 } };
      return { state, phase: execState.phase, done: true };
    }

    yield { type: 'phase-change', from: { type: 'streaming' }, to: execState.phase };
    return { state, phase: execState.phase, done: false };
  }

  // For other phases, delegate to executeAdvance()
  const result = await executeAdvance(ctx, state, execState, registry, options);
  yield { type: 'phase-change', from: fromPhase, to: result.phase };

  return result;
}

/**
 * Stream one ReAct cycle with observation (meso-step streaming)
 */
export async function* executeStepStream(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  toolRegistry?: IToolRegistry,
  options?: { signal?: AbortSignal }
): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  const execState = createExecutionState();

  let currentState = state;
  while (!isTerminalPhase(execState.phase)) {
    options?.signal?.throwIfAborted();
    const fromPhase = execState.phase;

    // Special: streaming LLM response (single streaming call, no double invocation)
    if (fromPhase.type === 'calling-llm') {
      yield { type: 'phase-change', from: fromPhase, to: { type: 'streaming' } };

      try {
        yield* streamCallingLLM(ctx, currentState, execState, registry, options?.signal);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        execState.phase = { type: 'error', error: errorObj };
        yield { type: 'error', error: errorObj, context: { step: 0 } };
        return { state: currentState, result: { type: 'error', error: errorObj } };
      }

      yield { type: 'phase-change', from: { type: 'streaming' }, to: execState.phase };
      continue;
    }

    // All other phases: delegate to executeAdvance()
    const {
      state: newState,
      phase,
      done,
    } = await executeAdvance(ctx, currentState, execState, registry, options);
    currentState = await maybeCompress(compressor, newState);

    // Emit tool events based on phase transitions
    if (phase.type === 'executing-tool') {
      yield {
        type: 'tool:start',
        action: phase.action,
      };
    }

    yield { type: 'phase-change', from: fromPhase, to: phase };

    if (phase.type === 'tool-result') {
      // Handle skill signals for nested skill calling
      if (isSkillSignal(phase.result)) {
        const signal = phase.result as SkillSignal;
        const skillState = currentState.context.skillState;

        if (signal.type === 'SWITCH_SKILL' && skillState) {
          // 用 updateState 保证 Immer 冻结对象也能安全修改
          currentState = updateState(currentState, (draft) => {
            const ss = draft.context.skillState!;
            if (ss.current) {
              ss.stack.push({
                skillName: ss.current,
                loadedAt: Date.now(),
                taskContext: signal.task,
              });
            }
            ss.current = signal.to;
            ss.loadedInstructions = signal.instructions;
          });

          // Yield skill event and continue execution
          yield { type: 'skill:start', name: signal.to, task: signal.task };

          // Reset phase to idle to continue with new skill
          execState.phase = { type: 'idle' };
          continue;
        }

        if (signal.type === 'RETURN_SKILL' && skillState) {
          const stackLen = skillState.stack.length;
          if (stackLen === 0) {
            // 顶层 skill 无父 skill 可退，静默忽略
            execState.phase = { type: 'idle' };
            continue;
          }

          // 用 updateState 保证 Immer 冻结对象也能安全修改
          let parentSkillName: string;
          currentState = updateState(currentState, (draft) => {
            const ss = draft.context.skillState!;
            const parent = ss.stack.pop()!;
            parentSkillName = parent.skillName;
            ss.current = parentSkillName;
            delete ss.loadedInstructions;
          });

          // Yield skill event
          yield { type: 'skill:end', name: parentSkillName!, result: signal.result };

          // Reset phase to idle to continue with parent skill
          execState.phase = { type: 'idle' };
          continue;
        }

        if (signal.type === 'SKILL_NOT_FOUND') {
          const error = new Error(
            `Skill '${signal.requested}' not found. Available: ${signal.available.join(', ')}`
          );
          yield { type: 'error', error, context: { step: 0 } };
          return { state: currentState, result: { type: 'error', error } };
        }
      }

      // When delegate tool execution completes, wrap and yield sub-agent events
      if (fromPhase.type === 'executing-tool' && fromPhase.action.tool === 'delegate') {
        const delegateAction = fromPhase.action;
        const agentName = String(delegateAction.arguments.agent ?? '');
        const taskDesc = String(delegateAction.arguments.task ?? '');
        yield { type: 'subagent:start', name: agentName, task: taskDesc };
      }

      yield {
        type: 'tool:end',
        result: phase.result,
      };

      // When delegate tool execution completes, yield subagent:end event
      if (fromPhase.type === 'executing-tool' && fromPhase.action.tool === 'delegate') {
        const agentName = String(fromPhase.action.arguments.agent ?? '');
        yield {
          type: 'subagent:end',
          name: agentName,
          result: phase.result as import('./subagent/types.js').DelegateResult,
        };
      }

      return {
        state: currentState,
        result: {
          type: 'continue',
          toolResult: phase.result,
        },
      };
    }

    if (done && phase.type === 'completed') {
      return {
        state: currentState,
        result: { type: 'done', answer: phase.answer },
      };
    }

    if (done && phase.type === 'error') {
      yield { type: 'error', error: phase.error, context: { step: 0 } };
      return { state: currentState, result: { type: 'error', error: phase.error } };
    }
  }

  // Should not reach here: all terminal phases are handled inside the loop body
  throw new Error('Unexpected: stepStream loop exited without reaching terminal phase');
}

import type { RunResult, RunStreamEvent } from './execution.js';

/**
 * Stream run until completion (macro-step streaming)
 */
export async function* executeRunStream(
  ctx: RunnerContext,
  compressor: IContextCompressor | undefined,
  state: AgentState,
  options?: { maxSteps?: number; signal?: AbortSignal },
  toolRegistry?: IToolRegistry
): AsyncGenerator<RunStreamEvent, { state: AgentState; result: RunResult }> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  // maxSteps hierarchy: run parameter > RunnerOptions > default 10
  const maxSteps = options?.maxSteps ?? ctx.options.maxSteps ?? 10;
  let currentState = state;
  let totalSteps = 0;

  while (totalSteps < maxSteps) {
    options?.signal?.throwIfAborted();
    yield { type: 'step:start', step: totalSteps, state: currentState };

    // Use stepStream to get real-time tokens and phase events
    const iterator = executeStepStream(ctx, compressor, currentState, registry, options);
    let stepResult: { state: AgentState; result: StepResult };

    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        stepResult = value;
        break;
      }
      // Forward all events from stepStream (token, phase-change, tool:start/end)
      yield value as RunStreamEvent;
    }

    currentState = stepResult.state;
    totalSteps++;

    yield { type: 'step:end', step: totalSteps - 1, result: stepResult.result };

    // Auto-compress between steps (yield events so UI can observe)
    if (compressor && compressor.shouldCompress(currentState)) {
      yield { type: 'compressing' };
      const compressedState = await maybeCompress(compressor, currentState);
      if (compressedState.context.compression) {
        const prevAnchor = stepResult.state.context.compression?.anchor ?? 0;
        const newAnchor = compressedState.context.compression.anchor;
        yield {
          type: 'compressed',
          summary: compressedState.context.compression.summary,
          removedCount: newAnchor - prevAnchor,
        };
        currentState = compressedState;
      }
    }

    if (stepResult.result.type === 'done') {
      const runResult: RunResult = {
        type: 'success',
        answer: stepResult.result.answer,
        totalSteps,
      };
      yield { type: 'complete', result: runResult };
      return { state: currentState, result: runResult };
    }

    if (stepResult.result.type === 'error') {
      const runResult: RunResult = {
        type: 'error',
        error: stepResult.result.error,
        totalSteps,
      };
      yield { type: 'complete', result: runResult };
      return { state: currentState, result: runResult };
    }
  }

  // maxSteps exhausted
  const runResult: RunResult = { type: 'max_steps', totalSteps };
  yield { type: 'complete', result: runResult };
  return { state: currentState, result: runResult };
}
