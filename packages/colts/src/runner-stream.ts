/**
 * @fileoverview Streaming Execution Helpers
 *
 * Handles streaming LLM response, advance streaming, and step streaming.
 * Extracted from AgentRunner for maintainability.
 */

import type { AgentState, IToolRegistry } from './types.js';
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
      // 当 delegate 工具执行完成时，包装 yield 子 agent 事件
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

      // 当 delegate 工具执行完成时，yield subagent:end 事件
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

  // 不应到达此处：所有终止 phase 在循环体内已处理
  throw new Error('Unexpected: stepStream loop exited without reaching terminal phase');
}
