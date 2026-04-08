/**
 * @fileoverview AgentRunner - Step 1 & 4: Basic LLM Chat and Step Control
 *
 * Stateless runner that executes AgentState with LLM integration.
 * Supports both blocking/streaming chat and fine-grained step control.
 */

import type { LLMClient, TokenStats } from '@agentskillmania/llm-client';
import type { Message, TextContent, Tool } from '@mariozechner/pi-ai';
import type { AgentState } from './types.js';
import {
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  incrementStepCount,
} from './state.js';
import { parseResponse } from './parser.js';
import { ToolRegistry } from './tools/registry.js';
import type { StepResult, AdvanceResult, ExecutionState, StreamEvent } from './execution.js';
import { createExecutionState, toolCallToAction, isTerminalPhase } from './execution.js';

/**
 * Configuration options for AgentRunner
 */
export interface RunnerOptions {
  /** Model identifier to use for LLM calls */
  model: string;

  /** LLM client instance */
  llmClient: LLMClient;

  /** System prompt/instructions (optional) - merged with AgentConfig.instructions */
  systemPrompt?: string;

  /** Request timeout in milliseconds (optional) */
  requestTimeout?: number;

  /** Tool registry for function calling (optional) */
  toolRegistry?: ToolRegistry;
}

/**
 * Options for individual chat calls
 */
export interface ChatOptions {
  /** Request priority for LLM calls (default: 0) */
  priority?: number;
}

/**
 * Result of a chat() call
 */
export interface ChatResult {
  /** Updated state with new messages */
  state: AgentState;

  /** Assistant's response content */
  response: string;

  /** Token usage statistics */
  tokens: TokenStats;

  /** Stop reason from LLM */
  stopReason: string;
}

/**
 * Chunk emitted during chatStream()
 */
export interface ChatStreamChunk {
  /** Event type */
  type: 'text' | 'done' | 'error';

  /** Incremental content (for 'text' events) */
  delta?: string;

  /** Accumulated content so far */
  accumulatedContent?: string;

  /** State at this point in the stream */
  state: AgentState;

  /** Token usage (for 'done' events) */
  tokens?: TokenStats;

  /** Error message (for 'error' events) */
  error?: string;
}

/**
 * AgentRunner - Stateless executor for AgentState
 *
 * @remarks
 * AgentRunner is designed to be completely stateless. It receives an AgentState,
 * executes LLM operations, and returns a new AgentState. This enables:
 * - Running multiple AgentState instances concurrently
 * - Easy testing and debugging
 * - Time travel and replay capabilities
 *
 * Design decisions:
 * - systemPrompt is set on Runner as a default, merged with AgentConfig.instructions
 * - priority is per-call, allowing dynamic prioritization of different requests
 *
 * @example
 * Basic usage:
 * ```typescript
 * const runner = new AgentRunner({
 *   model: 'gpt-4',
 *   llmClient: client,
 *   systemPrompt: 'You are a helpful assistant.'
 * });
 *
 * // Blocking chat with default priority
 * const result = await runner.chat(state, 'Hello!');
 * console.log(result.response);
 *
 * // High priority chat
 * const urgent = await runner.chat(state, 'Urgent!', { priority: 10 });
 *
 * // Streaming chat
 * for await (const chunk of runner.chatStream(state, 'Hello!')) {
 *   if (chunk.type === 'text') {
 *     process.stdout.write(chunk.delta);
 *   }
 * }
 * ```
 */
export class AgentRunner {
  constructor(private options: RunnerOptions) {}

  /**
   * Execute a single turn of conversation (blocking)
   *
   * @param state - Current agent state
   * @param userInput - User's message content
   * @param chatOptions - Optional chat configuration (priority, etc.)
   * @returns ChatResult with updated state and response
   *
   * @example
   * ```typescript
   * // Default priority
   * const result = await runner.chat(state, 'What is 2+2?');
   *
   * // High priority
   * const result = await runner.chat(state, 'Urgent!', { priority: 10 });
   *
   * console.log(result.response); // "4"
   * console.log(result.tokens); // { input: 15, output: 2 }
   * ```
   */
  async chat(state: AgentState, userInput: string, chatOptions?: ChatOptions): Promise<ChatResult> {
    // 1. Add user message to state
    let newState = addUserMessage(state, userInput);

    // 2. Prepare messages for LLM
    const messages = this.buildMessages(newState);

    // 3. Call LLM
    const response = await this.options.llmClient.call({
      model: this.options.model,
      messages,
      priority: chatOptions?.priority ?? 0,
      requestTimeout: this.options.requestTimeout,
    });

    // 4. Add assistant message to state
    newState = addAssistantMessage(newState, response.content, {
      type: 'final',
      visible: true,
    });

    // 5. Increment step count
    newState = incrementStepCount(newState);

    return {
      state: newState,
      response: response.content,
      tokens: response.tokens,
      stopReason: response.stopReason,
    };
  }

  /**
   * Execute a single turn of conversation (streaming)
   *
   * @param state - Current agent state
   * @param userInput - User's message content
   * @param chatOptions - Optional chat configuration (priority, etc.)
   * @returns Async iterable of ChatStreamChunk
   *
   * @remarks
   * The stream yields intermediate states that include the accumulated
   * content up to that point. The final state is only included in the
   * 'done' event.
   *
   * @example
   * ```typescript
   * // Default priority
   * for await (const chunk of runner.chatStream(state, 'Write a poem')) {
   *   switch (chunk.type) {
   *     case 'text':
   *       process.stdout.write(chunk.delta);
   *       break;
   *     case 'done':
   *       console.log('\nTotal tokens:', chunk.tokens);
   *       break;
   *     case 'error':
   *       console.error('Error:', chunk.error);
   *       break;
   *   }
   * }
   *
   * // Low priority (background processing)
   * for await (const chunk of runner.chatStream(state, 'Background task', { priority: -5 })) {
   *   // ...
   * }
   * ```
   */
  async *chatStream(
    state: AgentState,
    userInput: string,
    chatOptions?: ChatOptions
  ): AsyncIterable<ChatStreamChunk> {
    // 1. Add user message to state (initial state for streaming)
    const currentState = addUserMessage(state, userInput);

    // 2. Prepare messages for LLM
    const messages = this.buildMessages(currentState);

    // 3. Start streaming
    let accumulatedContent = '';

    try {
      for await (const event of this.options.llmClient.stream({
        model: this.options.model,
        messages,
        priority: chatOptions?.priority ?? 0,
        requestTimeout: this.options.requestTimeout,
      })) {
        switch (event.type) {
          case 'text': {
            accumulatedContent =
              event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');

            // Yield intermediate state with accumulated content
            yield {
              type: 'text',
              delta: event.delta,
              accumulatedContent,
              state: currentState,
            };
            break;
          }

          case 'done': {
            // Finalize state with complete response
            const finalState = incrementStepCount(
              addAssistantMessage(currentState, accumulatedContent, {
                type: 'final',
                visible: true,
              })
            );

            yield {
              type: 'done',
              accumulatedContent,
              state: finalState,
              tokens: event.roundTotalTokens,
            };
            break;
          }

          case 'error': {
            yield {
              type: 'error',
              error: event.error,
              state: currentState,
            };
            break;
          }

          // Ignore other event types for basic chat
          default:
            break;
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        state: currentState,
      };
    }
  }

  /**
   * Build messages array for LLM call from current state
   *
   * @param state - Current agent state
   * @returns Array of messages in LLM format
   *
   * @private
   */
  private buildMessages(state: AgentState): Message[] {
    const messages: Message[] = [];
    const now = Date.now();

    // Combine system prompts into a single user message prefix
    // pi-ai doesn't have a 'system' role, so we prepend to first user message
    // or create a user message with instructions
    const systemParts: string[] = [];

    if (this.options.systemPrompt) {
      systemParts.push(this.options.systemPrompt);
    }

    if (state.config.instructions) {
      systemParts.push(state.config.instructions);
    }

    // Add combined system prompt as first message if exists
    if (systemParts.length > 0) {
      messages.push({
        role: 'user',
        content: `[System Instructions]\n${systemParts.join('\n\n')}`,
        timestamp: now,
      });

      // Add a fake assistant acknowledgment to maintain conversation flow
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Understood. I will follow these instructions.' }],
        api: 'openai-completions',
        provider: 'openai',
        model: this.options.model,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      });
    }

    // Add conversation history
    for (const msg of state.context.messages) {
      switch (msg.role) {
        case 'user':
          messages.push({
            role: 'user',
            content: msg.content,
            timestamp: now,
          });
          break;

        case 'assistant': {
          // Only include visible messages in LLM context
          if (msg.visible !== false) {
            const content: TextContent[] = [{ type: 'text', text: msg.content }];
            messages.push({
              role: 'assistant',
              content,
              api: 'openai-completions',
              provider: 'openai',
              model: this.options.model,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: 'stop',
              timestamp: now,
            });
          }
          break;
        }

        case 'tool':
          // Tool results use 'toolResult' role in pi-ai
          messages.push({
            role: 'toolResult',
            toolCallId: msg.toolCallId ?? 'unknown',
            toolName: 'unknown',
            content: [{ type: 'text', text: msg.content }],
            isError: false,
            timestamp: now,
          });
          break;
      }
    }

    return messages;
  }

  /**
   * Convert ToolRegistry schemas to pi-ai Tool format
   *
   * @param registry - Tool registry
   * @returns Tools in pi-ai format
   * @private
   */
  private getToolsForLLM(registry?: ToolRegistry): Tool[] | undefined {
    if (!registry) return undefined;

    const schemas = registry.toToolSchemas();
    return schemas.map((schema) => ({
      name: schema.function.name,
      description: schema.function.description,
      parameters: schema.function.parameters as unknown as Tool['parameters'],
    }));
  }

  /**
   * 🔬 Micro-step: Advance one execution phase
   *
   * Each call progresses to the next natural breakpoint:
   * idle → preparing → calling-llm → llm-response → parsing → parsed
   * → executing-tool (if action) → tool-result → completed
   *
   * @param state - Current agent state
   * @param execState - Execution state tracking current phase
   * @param toolRegistry - Optional tool registry
   * @returns Updated state, current phase, and completion status
   *
   * @example
   * ```typescript
   * let state = createAgentState({...});
   * let execState = createExecutionState();
   *
   * while (true) {
   *   const { state: newState, phase, done } = await runner.advance(state, execState);
   *   state = newState;
   *
   *   console.log('Entered phase:', phase.type);
   *
   *   // Intervene at specific phases
   *   if (phase.type === 'parsed' && phase.action) {
   *     console.log('About to execute:', phase.action);
   *     // Can modify action here before continuing
   *   }
   *
   *   if (done) break;
   * }
   * ```
   */
  async advance(
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: ToolRegistry
  ): Promise<AdvanceResult> {
    const registry = toolRegistry ?? this.options.toolRegistry;
    const currentPhase = execState.phase;

    try {
      switch (currentPhase.type) {
        case 'idle':
          return this.advanceToPreparing(state, execState);

        case 'preparing':
          return this.advanceToCallingLLM(state, execState);

        case 'calling-llm':
          return await this.advanceToLLMResponse(state, execState, registry);

        case 'llm-response':
          return this.advanceToParsing(state, execState);

        case 'parsing':
          return this.advanceToParsed(state, execState);

        case 'parsed':
          return this.advanceFromParsed(state, execState);

        case 'executing-tool':
          return await this.advanceToToolResult(state, execState, registry);

        case 'tool-result':
          return this.advanceToCompleted(state, execState);

        case 'completed':
        case 'error':
          // Already terminal
          return { state, phase: currentPhase, done: true };

        default:
          execState.phase = { type: 'error', error: new Error(`Unknown phase: ${currentPhase}`) };
          return { state, phase: execState.phase, done: true };
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      execState.phase = { type: 'error', error: errorObj };
      return { state, phase: execState.phase, done: true };
    }
  }

  private advanceToPreparing(state: AgentState, execState: ExecutionState): AdvanceResult {
    const messages = this.buildMessages(state);
    execState.preparedMessages = messages;
    // For the phase, we convert to our Message type for display
    const displayMessages: import('./types.js').Message[] = messages.map((m) => ({
      role: m.role as import('./types.js').MessageRole,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: Date.now(),
    }));
    execState.phase = { type: 'preparing', messages: displayMessages };
    return { state, phase: execState.phase, done: false };
  }

  private advanceToCallingLLM(state: AgentState, execState: ExecutionState): AdvanceResult {
    execState.phase = { type: 'calling-llm' };
    return { state, phase: execState.phase, done: false };
  }

  private async advanceToLLMResponse(
    state: AgentState,
    execState: ExecutionState,
    registry?: ToolRegistry
  ): Promise<AdvanceResult> {
    const tools = this.getToolsForLLM(registry);

    const response = await this.options.llmClient.call({
      model: this.options.model,
      messages: execState.preparedMessages ?? this.buildMessages(state),
      tools,
      priority: 0,
      requestTimeout: this.options.requestTimeout,
    });

    // Store LLM response
    const responseText = response.content;
    execState.llmResponse = responseText;

    // Also store tool calls if present
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0];
      execState.action = toolCallToAction(toolCall);
    }

    execState.phase = { type: 'llm-response', response: responseText };
    return { state, phase: execState.phase, done: false };
  }

  private advanceToParsing(state: AgentState, execState: ExecutionState): AdvanceResult {
    execState.phase = { type: 'parsing' };
    return { state, phase: execState.phase, done: false };
  }

  private advanceToParsed(state: AgentState, execState: ExecutionState): AdvanceResult {
    const parseResult = parseResponse({
      content: execState.llmResponse ?? '',
      thinking: undefined,
      toolCalls: execState.action
        ? [
            {
              id: execState.action.id,
              name: execState.action.tool,
              arguments: execState.action.arguments,
            },
          ]
        : [],
      tokens: { input: 0, output: 0 },
      stopReason: 'stop',
    });

    execState.thought = parseResult.thought;

    if (parseResult.toolCalls.length > 0) {
      const action = toolCallToAction(parseResult.toolCalls[0]);
      execState.action = action;
      execState.phase = { type: 'parsed', thought: parseResult.thought, action };
    } else {
      execState.phase = { type: 'parsed', thought: parseResult.thought };
    }

    return { state, phase: execState.phase, done: false };
  }

  private advanceFromParsed(state: AgentState, execState: ExecutionState): AdvanceResult {
    if (execState.action) {
      // Need to execute tool
      execState.phase = { type: 'executing-tool', action: execState.action };
      return { state, phase: execState.phase, done: false };
    } else {
      // No tool needed, complete this step
      return this.advanceToCompleted(state, execState);
    }
  }

  private async advanceToToolResult(
    state: AgentState,
    execState: ExecutionState,
    registry?: ToolRegistry
  ): Promise<AdvanceResult> {
    const action = execState.action;
    if (!action) {
      throw new Error('No action to execute');
    }

    let result: unknown;
    if (registry) {
      try {
        result = await registry.execute(action.tool, action.arguments);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result = `Error: ${errorMessage}`;
      }
    } else {
      result = `Tool '${action.tool}' not executed: no tool registry provided`;
    }

    execState.toolResult = result;
    execState.phase = { type: 'tool-result', result };

    return { state, phase: execState.phase, done: false };
  }

  private advanceToCompleted(state: AgentState, execState: ExecutionState): AdvanceResult {
    const answer = execState.thought ?? '';
    execState.phase = { type: 'completed', answer };
    return { state, phase: execState.phase, done: true };
  }

  /**
   * 🔬 Micro-step: Stream phase advancement
   *
   * @param state - Current agent state
   * @param execState - Execution state
   * @param toolRegistry - Optional tool registry
   * @returns Async generator of stream events
   */
  async *advanceStream(
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: ToolRegistry
  ): AsyncGenerator<StreamEvent, AdvanceResult> {
    const registry = toolRegistry ?? this.options.toolRegistry;
    const fromPhase = execState.phase;

    // Emit phase change at start
    if (fromPhase.type === 'idle') {
      // Will transition to preparing
    }

    // For now, delegate to advance() and emit synthetic events
    // A full streaming implementation would need LLM client support
    // for streaming with tool calls

    if (fromPhase.type === 'calling-llm') {
      // Stream LLM response
      const tools = this.getToolsForLLM(registry);
      let accumulatedContent = '';

      yield { type: 'phase-change', from: fromPhase, to: { type: 'streaming', token: '' } };

      for await (const event of this.options.llmClient.stream({
        model: this.options.model,
        messages: execState.preparedMessages ?? this.buildMessages(state),
        tools,
        priority: 0,
        requestTimeout: this.options.requestTimeout,
      })) {
        if (event.type === 'text') {
          accumulatedContent = event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');
          yield { type: 'token', token: event.delta ?? '' };
        }
      }

      execState.llmResponse = accumulatedContent;
      execState.phase = { type: 'streaming', token: accumulatedContent };
    }

    // Delegate remaining to advance()
    const result = await this.advance(state, execState, registry);
    yield { type: 'phase-change', from: fromPhase, to: result.phase };

    return result;
  }

  /**
   * 🦶 Meso-step: Complete one ReAct cycle
   *
   * Internally composed of multiple advance() calls:
   * preparing → calling-llm → llm-response → parsing → parsed
   * → [executing-tool → tool-result if action] → completed
   *
   * @param state - Current agent state
   * @param toolRegistry - Optional tool registry
   * @returns Updated state and step result
   *
   * @example
   * ```typescript
   * // Step with no tools needed
   * const { state: newState, result } = await runner.step(state);
   * if (result.type === 'done') {
   *   console.log('Answer:', result.answer);
   * }
   *
   * // Step with tool execution
   * if (result.type === 'continue') {
   *   console.log('Tool result:', result.toolResult);
   *   const final = await runner.step(newState);
   * }
   * ```
   */
  async step(
    state: AgentState,
    toolRegistry?: ToolRegistry
  ): Promise<{ state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.options.toolRegistry;
    const execState = createExecutionState();

    // Execute phases until completion
    while (!isTerminalPhase(execState.phase)) {
      const { state: newState, phase, done } = await this.advance(state, execState, registry);
      state = newState;

      if (done && phase.type === 'completed') {
        // Final answer
        const newState = incrementStepCount(
          addAssistantMessage(state, phase.answer, {
            type: 'final',
            visible: true,
          })
        );
        return { state: newState, result: { type: 'done', answer: phase.answer } };
      }

      if (done && phase.type === 'error') {
        // Error occurred
        const newState = incrementStepCount(
          addAssistantMessage(state, phase.error.message, {
            type: 'final',
            visible: true,
          })
        );
        return { state: newState, result: { type: 'done', answer: phase.error.message } };
      }

      // If we reached tool-result, we need to continue the step
      if (phase.type === 'tool-result') {
        // Add assistant thought and tool result to state
        const thought = execState.thought ?? '';
        let newState = addAssistantMessage(state, thought, {
          type: 'thought',
          visible: false,
        });

        const toolResultContent =
          typeof phase.result === 'string' ? phase.result : JSON.stringify(phase.result);
        newState = addToolMessage(newState, toolResultContent);
        newState = incrementStepCount(newState);

        return { state: newState, result: { type: 'continue', toolResult: phase.result } };
      }
    }

    // Should not reach here, but handle gracefully
    return { state, result: { type: 'done', answer: execState.thought ?? '' } };
  }

  /**
   * 🦶 Meso-step: Stream one ReAct cycle with observation
   *
   * @param state - Current agent state
   * @param toolRegistry - Optional tool registry
   * @returns Async generator of stream events
   */
  async *stepStream(
    state: AgentState,
    toolRegistry?: ToolRegistry
  ): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.options.toolRegistry;
    const execState = createExecutionState();

    // Emit initial phase change
    yield { type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing', messages: [] } };

    // Execute phases until completion, emitting events
    while (!isTerminalPhase(execState.phase)) {
      const fromPhase = execState.phase;

      // Special handling for streaming LLM response
      if (fromPhase.type === 'calling-llm') {
        yield { type: 'phase-change', from: fromPhase, to: { type: 'streaming', token: '' } };

        const tools = this.getToolsForLLM(registry);
        let accumulatedContent = '';

        for await (const event of this.options.llmClient.stream({
          model: this.options.model,
          messages: execState.preparedMessages ?? this.buildMessages(state),
          tools,
          priority: 0,
          requestTimeout: this.options.requestTimeout,
        })) {
          if (event.type === 'text') {
            accumulatedContent =
              event.accumulatedContent ?? accumulatedContent + (event.delta ?? '');
            yield { type: 'token', token: event.delta ?? '' };
          }
        }

        // After streaming, we need to get the full response including tool calls
        // For now, use non-streaming call to get complete response
        const response = await this.options.llmClient.call({
          model: this.options.model,
          messages: execState.preparedMessages ?? this.buildMessages(state),
          tools,
          priority: 0,
          requestTimeout: this.options.requestTimeout,
        });

        execState.llmResponse = response.content;
        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolCall = response.toolCalls[0];
          execState.action = {
            id: toolCall.id,
            tool: toolCall.name,
            arguments: toolCall.arguments,
          };
        }
        // Skip streaming phase and go directly to llm-response
        // (streaming was already observed via tokens)
        execState.phase = { type: 'llm-response', response: accumulatedContent };

        // Continue to next phase
        continue;
      }

      // Handle tool execution
      if (fromPhase.type === 'executing-tool' && execState.action) {
        yield { type: 'tool:start', action: execState.action };

        let result: unknown;
        if (registry) {
          try {
            result = await registry.execute(execState.action.tool, execState.action.arguments);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result = `Error: ${errorMessage}`;
          }
        } else {
          result = `Tool '${execState.action.tool}' not executed: no tool registry provided`;
        }

        execState.toolResult = result;
        execState.phase = { type: 'tool-result', result };

        yield { type: 'tool:end', result };
        yield {
          type: 'phase-change',
          from: fromPhase,
          to: execState.phase,
        };

        // Build state with tool result and return
        const thought = execState.thought ?? '';
        let newState = addAssistantMessage(state, thought, {
          type: 'thought',
          visible: false,
        });

        const toolResultContent = typeof result === 'string' ? result : JSON.stringify(result);
        newState = addToolMessage(newState, toolResultContent);
        newState = incrementStepCount(newState);

        const stepResult: StepResult = { type: 'continue', toolResult: result };
        return { state: newState, result: stepResult };
      }

      // Normal advance
      const { state: newState, phase } = await this.advance(state, execState, registry);
      state = newState;

      yield { type: 'phase-change', from: fromPhase, to: phase };
    }

    // Completed
    if (execState.phase.type === 'completed') {
      const answer = execState.phase.answer;
      const newState = incrementStepCount(
        addAssistantMessage(state, answer, {
          type: 'final',
          visible: true,
        })
      );
      return { state: newState, result: { type: 'done', answer } };
    }

    // Error case
    if (execState.phase.type === 'error') {
      const errorMessage = execState.phase.error.message;
      const newState = incrementStepCount(
        addAssistantMessage(state, errorMessage, {
          type: 'final',
          visible: true,
        })
      );
      return { state: newState, result: { type: 'done', answer: errorMessage } };
    }

    // Fallback
    return { state, result: { type: 'done', answer: execState.thought ?? '' } };
  }
}
