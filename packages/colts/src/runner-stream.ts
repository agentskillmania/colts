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
import { getToolsForLLM } from './tools/llm-format.js';
import { maybeCompress } from './runner-compression.js';
import type { IContextCompressor } from './types.js';
import { processToolResult } from './runner-process-tool-result.js';
import type { ToolPostEffect } from './runner-process-tool-result.js';

/**
 * Stream LLM response during calling-llm phase.
 *
 * Shared between advanceStream() and stepStream() to avoid duplicate logic.
 * Yields token events in real-time and stores the complete response in execState.
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @param execState - Execution state
 * @param registry - Optional tool registry
 * @param signal - Optional abort signal
 * @yields StreamEvent token events
 */
export async function* streamCallingLLM(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  registry?: IToolRegistry,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  const tools = getToolsForLLM(registry);
  const messages = execState.preparedMessages ?? buildMessagesFromCtx(ctx, state);

  // Yield llm:request event before LLM call, carrying the full input
  yield {
    type: 'llm:request',
    messages: messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    tools: tools?.map((t) => t.name) ?? [],
    skill: state.context.skillState
      ? {
          current: state.context.skillState.current,
          stack: state.context.skillState.stack.map((f) => f.skillName),
        }
      : null,
  };

  let accumulatedContent = '';
  let responseContent = '';
  let responseToolCalls:
    | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    | undefined;

  for await (const event of ctx.llmProvider.stream({
    model: ctx.options.model,
    messages,
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

  // Yield llm:response event after LLM response, carrying the full output
  yield {
    type: 'llm:response',
    text: responseContent,
    toolCalls: responseToolCalls ?? null,
  };

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
  } else {
    // New response has no toolCalls; clear stale action to prevent reusing expired tool calls
    execState.action = undefined;
    execState.allActions = undefined;
  }
  execState.phase = { type: 'llm-response', response: responseContent };
}

/**
 * Stream phase advancement (micro-step streaming)
 *
 * @param ctx - Runner context
 * @param state - Current agent state
 * @param execState - Execution state
 * @param toolRegistry - Optional tool registry
 * @param options - Optional advance options
 * @yields Stream events during phase advancement
 * @returns Final advance result
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
 *
 * @param ctx - Runner context
 * @param compressor - Optional context compressor
 * @param state - Current agent state
 * @param toolRegistry - Optional tool registry
 * @param options - Optional execution options
 * @yields Stream events during the step
 * @returns Final state and step result
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

    // Tool-result: delegate to shared processToolResult
    if (phase.type === 'tool-result') {
      const outcome = await processToolResult(currentState, execState, registry);
      currentState = await maybeCompress(compressor, outcome.state);

      // Yield lifecycle effects, skip step-control effects
      for (const effect of outcome.effects) {
        if ((effect.type as string).startsWith('step:')) continue;
        yield effect as StreamEvent;
      }

      // Determine step control flow from effects
      const stepEffect = outcome.effects.find((e): e is ToolPostEffect & { type: string } =>
        (e.type as string).startsWith('step:')
      );

      if (stepEffect?.type === 'step:continue') {
        // Continue the while loop (e.g. skill loaded/returned)
        continue;
      }
      if (stepEffect?.type === 'step:done') {
        const answer = (stepEffect as { type: 'step:done'; answer: string }).answer;
        return { state: currentState, result: { type: 'done', answer } };
      }
      if (stepEffect?.type === 'step:error') {
        const error = (stepEffect as { type: 'step:error'; error: Error }).error;
        return { state: currentState, result: { type: 'error', error } };
      }

      // step:continue-return (same-skill, cyclic, plain tool)
      const toolResult = (stepEffect as { type: 'step:continue-return'; toolResult: unknown })
        .toolResult;
      return { state: currentState, result: { type: 'continue', toolResult } };
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
