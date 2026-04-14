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
import { isSkillSignal, type SkillSignal } from './skills/types.js';
import {
  applySkillSignal,
  formatSkillToolResult,
  formatSkillAnswer,
} from './skills/signal-handler.js';

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

  // 在 LLM 调用前 yield llm:request 事件，携带完整输入
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

  // LLM 响应完成后 yield llm:response 事件，携带完整输出
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
    // 新响应没有 toolCalls，清除上一次残留的 action，防止重用过期工具调用
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

    if (phase.type === 'tool-result') {
      // Handle skill signals via centralized handler
      if (isSkillSignal(phase.result)) {
        const [newState, sigResult] = applySkillSignal(currentState, phase.result as SkillSignal);
        currentState = newState;

        switch (sigResult.action) {
          case 'loaded':
            // Skill loaded (first time or nested)
            yield {
              type: 'skill:start',
              name: sigResult.skillName,
              task: (phase.result as SkillSignal & { task: string }).task ?? '',
              state: currentState,
            };
            yield { type: 'tool:end', result: formatSkillToolResult(phase.result) };
            execState.phase = { type: 'idle' };
            continue;

          case 'returned':
            // Sub-skill finished, returned to parent
            yield {
              type: 'skill:end',
              name: sigResult.parentName,
              result: (phase.result as SkillSignal & { result: string }).result,
              state: currentState,
            };
            yield { type: 'tool:end', result: formatSkillToolResult(phase.result) };
            execState.phase = { type: 'idle' };
            continue;

          case 'top-level-return':
            // Top-level skill finished: yield skill:end for event symmetry, then end step
            yield {
              type: 'skill:end',
              name: sigResult.skillName,
              result: (phase.result as SkillSignal & { result: string }).result,
              state: currentState,
            };
            yield { type: 'tool:end', result: formatSkillToolResult(phase.result) };
            return {
              state: currentState,
              result: { type: 'done', answer: formatSkillAnswer(phase.result) },
            };

          case 'same-skill':
            // Already active — communicate clearly to LLM and TUI
            yield {
              type: 'tool:end',
              result: `Skill '${sigResult.currentSkill}' is already active`,
            };
            return { state: currentState, result: { type: 'continue', toolResult: phase.result } };

          case 'cyclic':
            // Would cause cycle — communicate clearly to LLM and TUI
            yield {
              type: 'tool:end',
              result: `Cannot load Skill '${sigResult.currentSkill}': already in the call stack`,
            };
            return { state: currentState, result: { type: 'continue', toolResult: phase.result } };

          case 'not-found':
            yield { type: 'error', error: sigResult.error, context: { step: 0 } };
            return { state: currentState, result: { type: 'error', error: sigResult.error } };
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
