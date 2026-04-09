/**
 * @fileoverview AgentRunner - Step 1, 4 & 6: Basic LLM Chat, Step Control and Configuration
 *
 * Stateless runner that executes AgentState with LLM integration.
 * Supports both blocking/streaming chat and fine-grained step control.
 * Step 6: Configurable with dependency inversion and quick initialization.
 */

import { LLMClient } from '@agentskillmania/llm-client';
import type { TokenStats } from '@agentskillmania/llm-client';
import type { Message, TextContent, Tool } from '@mariozechner/pi-ai';
import type { AgentState, ILLMProvider, IToolRegistry, LLMQuickInit } from './types.js';
import { ConfigurationError } from './types.js';
import {
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  incrementStepCount,
} from './state.js';
import { parseResponse } from './parser.js';
import { ToolRegistry } from './tools/registry.js';
import type { Tool as ColtsTool } from './tools/registry.js';
import type {
  StepResult,
  AdvanceResult,
  ExecutionState,
  StreamEvent,
  RunResult,
  RunStreamEvent,
} from './execution.js';
import { createExecutionState, toolCallToAction, isTerminalPhase } from './execution.js';

/**
 * Configuration options for AgentRunner
 *
 * Step 6: Supports both injection and quick initialization patterns
 */
export interface RunnerOptions {
  /** Model identifier to use for LLM calls */
  model: string;

  // --- LLM: injection or quick initialization (mutually exclusive) ---
  /** LLM provider instance (injection mode) */
  llmClient?: ILLMProvider;
  /** LLM quick initialization config (quick init mode) */
  llm?: LLMQuickInit;

  // --- Tools: injection or quick initialization (can be merged) ---
  /** Tool registry instance (injection mode) */
  toolRegistry?: IToolRegistry;
  /** Tools array for quick initialization */
  tools?: ColtsTool[];

  /** System prompt/instructions (optional) - merged with AgentConfig.instructions */
  systemPrompt?: string;

  /** Request timeout in milliseconds (optional) */
  requestTimeout?: number;

  /** Default max steps for run() (default: 10) */
  maxSteps?: number;
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
  private llmProvider: ILLMProvider;
  private toolRegistry: IToolRegistry;
  private options: RunnerOptions;

  constructor(options: RunnerOptions) {
    // Validate LLM configuration (mutually exclusive)
    if (options.llmClient && options.llm) {
      throw new ConfigurationError(
        'Cannot specify both llmClient and llm. Choose one: injection or quick initialization.'
      );
    }
    if (!options.llmClient && !options.llm) {
      throw new ConfigurationError('Must specify either llmClient or llm.');
    }

    // Initialize LLM provider
    if (options.llmClient) {
      this.llmProvider = options.llmClient;
    } else if (options.llm) {
      this.llmProvider = this.createLLMFromQuickInit(options.llm, options.model);
    } else {
      throw new ConfigurationError('No LLM provider configured.');
    }

    // Initialize tool registry (merge injection and quick init)
    const registry = options.toolRegistry
      ? (options.toolRegistry as ToolRegistry)
      : new ToolRegistry();
    if (options.tools && options.tools.length > 0) {
      for (const tool of options.tools) {
        registry.register(tool);
      }
    }
    this.toolRegistry = registry;

    // Store options with defaults
    this.options = {
      ...options,
      maxSteps: options.maxSteps ?? 10,
    };
  }

  /**
   * Create LLMClient from quick initialization config
   */
  private createLLMFromQuickInit(llm: LLMQuickInit, model: string): LLMClient {
    const concurrency = llm.maxConcurrency ?? 5;
    const provider = llm.provider ?? 'openai';

    const client = new LLMClient({ baseUrl: llm.baseUrl });
    client.registerProvider({ name: provider, maxConcurrency: concurrency });
    client.registerApiKey({
      key: llm.apiKey,
      provider,
      maxConcurrency: concurrency,
      models: [{ modelId: model, maxConcurrency: concurrency }],
    });

    return client;
  }

  /**
   * Register a tool at runtime
   */
  registerTool(tool: ColtsTool): void {
    (this.toolRegistry as ToolRegistry).register(tool);
  }

  /**
   * Unregister a tool at runtime
   */
  unregisterTool(name: string): boolean {
    return (this.toolRegistry as ToolRegistry).unregister(name);
  }

  /**
   * Get the internal LLM provider (for advanced use)
   */
  getLLMProvider(): ILLMProvider {
    return this.llmProvider;
  }

  /**
   * Get the internal tool registry (for advanced use)
   */
  getToolRegistry(): IToolRegistry {
    return this.toolRegistry;
  }

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
    const response = await this.llmProvider.call({
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
      for await (const event of this.llmProvider.stream({
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
  private getToolsForLLM(registry?: IToolRegistry): Tool[] | undefined {
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
   * Each call progresses to the next natural breakpoint and returns an immutable
   * new AgentState. The original state is never modified.
   *
   * @param state - Current agent state (immutable)
   * @param execState - Execution state tracking current phase (caller managed)
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
   *   state = newState; // Always use the new state
   *
   *   console.log('Entered phase:', phase.type);
   *
   *   // Intervene at specific phases
   *   if (phase.type === 'parsed' && phase.action) {
   *     console.log('About to execute:', phase.action);
   *     // Can modify action in execState before continuing
   *   }
   *
   *   if (done) break;
   * }
   * ```
   */
  async advance(
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: IToolRegistry
  ): Promise<AdvanceResult> {
    const registry = toolRegistry ?? this.toolRegistry;
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
          // Already terminal - return current state unchanged
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
    // Convert pi-ai Message format to colts internal format for phase display
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
    registry?: IToolRegistry
  ): Promise<AdvanceResult> {
    const tools = this.getToolsForLLM(registry);

    const response = await this.llmProvider.call({
      model: this.options.model,
      messages: execState.preparedMessages ?? this.buildMessages(state),
      tools,
      priority: 0,
      requestTimeout: this.options.requestTimeout,
    });

    // Store LLM response in execution state
    const responseText = response.content;
    execState.llmResponse = responseText;

    // Store all tool calls, not just the first
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Store first action for execution (parallel execution can be added later)
      const toolCall = response.toolCalls[0];
      execState.action = toolCallToAction(toolCall);
      // Store all actions for future use
      execState.allActions = response.toolCalls.map(toolCallToAction);
    }

    execState.phase = { type: 'llm-response', response: responseText };
    // Return new immutable state
    return { state, phase: execState.phase, done: false };
  }

  private advanceToParsing(state: AgentState, execState: ExecutionState): AdvanceResult {
    execState.phase = { type: 'parsing' };
    // Return new immutable state
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

    if (parseResult.toolCalls.length > 0 && execState.action) {
      execState.phase = { type: 'parsed', thought: parseResult.thought, action: execState.action };
    } else {
      execState.phase = { type: 'parsed', thought: parseResult.thought };
    }

    // Parsing complete: thought is known, but path not yet decided
    // (has action -> execute tool, no action -> complete directly)
    // State is not written here; advanceFromParsed / advanceToCompleted handle it
    return { state, phase: execState.phase, done: false };
  }

  private advanceFromParsed(state: AgentState, execState: ExecutionState): AdvanceResult {
    if (execState.action) {
      // Has tool call: write thought message, then enter executing-tool
      const thought = execState.thought ?? '';
      const newState = addAssistantMessage(state, thought, {
        type: 'thought',
        visible: false,
      });
      execState.phase = { type: 'executing-tool', action: execState.action };
      return { state: newState, phase: execState.phase, done: false };
    } else {
      // No tool call: complete directly, advanceToCompleted writes final message
      return this.advanceToCompleted(state, execState);
    }
  }

  private async advanceToToolResult(
    state: AgentState,
    execState: ExecutionState,
    registry?: IToolRegistry
  ): Promise<AdvanceResult> {
    const action = execState.action;
    if (!action) {
      throw new Error('No action to execute');
    }

    // Execute tool - registry is always provided after Step 6 refactor
    let result: unknown;
    try {
      result = await registry!.execute(action.tool, action.arguments);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result = `Error: ${errorMessage}`;
    }

    execState.toolResult = result;
    execState.phase = { type: 'tool-result', result };

    // Write tool message + increment step count
    const toolResultContent = typeof result === 'string' ? result : JSON.stringify(result);
    const newState = incrementStepCount(addToolMessage(state, toolResultContent));

    return { state: newState, phase: execState.phase, done: false };
  }

  private advanceToCompleted(state: AgentState, execState: ExecutionState): AdvanceResult {
    const answer = execState.thought ?? '';
    execState.phase = { type: 'completed', answer };

    // Two paths to completed:
    // 1. Direct answer (parsed -> completed): write final message + stepCount
    // 2. After tool execution (tool-result -> completed): messages already written by advanceToToolResult
    if (execState.toolResult === undefined) {
      const newState = incrementStepCount(
        addAssistantMessage(state, answer, { type: 'final', visible: true })
      );
      return { state: newState, phase: execState.phase, done: true };
    }

    return { state, phase: execState.phase, done: true };
  }

  /**
   * Stream LLM response during calling-llm phase.
   *
   * Shared between advanceStream() and stepStream() to avoid duplicate logic.
   * Yields token events in real-time and stores the complete response in execState.
   *
   * @param state - Current agent state
   * @param execState - Execution state
   * @param registry - Tool registry
   * @yields StreamEvent token events
   *
   * @private
   */
  private async *streamCallingLLM(
    state: AgentState,
    execState: ExecutionState,
    registry?: IToolRegistry
  ): AsyncGenerator<StreamEvent> {
    const tools = this.getToolsForLLM(registry);
    let accumulatedContent = '';
    let responseContent = '';
    let responseToolCalls:
      | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      | undefined;

    for await (const event of this.llmProvider.stream({
      model: this.options.model,
      messages: execState.preparedMessages ?? this.buildMessages(state),
      tools,
      priority: 0,
      requestTimeout: this.options.requestTimeout,
    })) {
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
    toolRegistry?: IToolRegistry
  ): AsyncGenerator<StreamEvent, AdvanceResult> {
    const registry = toolRegistry ?? this.toolRegistry;
    const fromPhase = execState.phase;

    // Handle streaming LLM response
    if (fromPhase.type === 'calling-llm') {
      yield { type: 'phase-change', from: fromPhase, to: { type: 'streaming' } };

      yield* this.streamCallingLLM(state, execState, registry);

      yield { type: 'phase-change', from: { type: 'streaming' }, to: execState.phase };
      return { state, phase: execState.phase, done: false };
    }

    // For other phases, delegate to advance()
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
   *   // Call step again with new state
   *   const final = await runner.step(newState);
   * }
   * ```
   */
  async step(
    state: AgentState,
    toolRegistry?: IToolRegistry
  ): Promise<{ state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    const execState = createExecutionState();

    // Loop advance() until a natural stopping point
    let currentState = state;
    while (!isTerminalPhase(execState.phase)) {
      const {
        state: newState,
        phase,
        done,
      } = await this.advance(currentState, execState, registry);
      currentState = newState;

      // Terminal: completed (direct answer, state already updated by advance)
      if (done && phase.type === 'completed') {
        return { state: currentState, result: { type: 'done', answer: phase.answer } };
      }

      // Terminal: error (write error message to state)
      // NOTE: Error handling in stepStream is difficult to test because
      // errors in LLM calls are caught by advance() and converted to error phase.
      // This branch handles edge cases where error phase is reached.
      if (done && phase.type === 'error') {
        const errorState = incrementStepCount(
          addAssistantMessage(currentState, phase.error.message, {
            type: 'final',
            visible: true,
          })
        );
        return { state: errorState, result: { type: 'done', answer: phase.error.message } };
      }

      // Non-terminal stopping point: tool-result (state already updated by advance)
      if (phase.type === 'tool-result') {
        return { state: currentState, result: { type: 'continue', toolResult: phase.result } };
      }
    }

    // Fallback (should not reach here)
    return { state: currentState, result: { type: 'done', answer: execState.thought ?? '' } };
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
    toolRegistry?: IToolRegistry
  ): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    const execState = createExecutionState();

    let currentState = state;
    while (!isTerminalPhase(execState.phase)) {
      const fromPhase = execState.phase;

      // Special: streaming LLM response (single streaming call, no double invocation)
      if (fromPhase.type === 'calling-llm') {
        yield { type: 'phase-change', from: fromPhase, to: { type: 'streaming' } };

        yield* this.streamCallingLLM(currentState, execState, registry);

        yield { type: 'phase-change', from: { type: 'streaming' }, to: execState.phase };
        continue;
      }

      // All other phases: delegate to advance() (no duplicate logic)
      const {
        state: newState,
        phase,
        done,
      } = await this.advance(currentState, execState, registry);
      currentState = newState;

      // Emit tool events based on phase transitions
      if (phase.type === 'executing-tool') {
        yield {
          type: 'tool:start',
          action: phase.action,
        };
      }

      yield { type: 'phase-change', from: fromPhase, to: phase };

      if (phase.type === 'tool-result') {
        yield {
          type: 'tool:end',
          result: phase.result,
        };
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
        const errorState = incrementStepCount(
          addAssistantMessage(currentState, phase.error.message, {
            type: 'final',
            visible: true,
          })
        );
        return { state: errorState, result: { type: 'done', answer: phase.error.message } };
      }
    }

    // Fallback
    return { state: currentState, result: { type: 'done', answer: execState.thought ?? '' } };
  }

  /**
   * 🏃 Macro-step: Run until completion
   *
   * Automatically loops step() until a final answer is reached or maxSteps exhausted.
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps)
   * @param toolRegistry - Optional tool registry override
   * @returns Final state and run result
   *
   * @example
   * ```typescript
   * const { state: finalState, result } = await runner.run(initialState);
   * if (result.type === 'success') {
   *   console.log('Answer:', result.answer);
   * }
   * ```
   */
  async run(
    state: AgentState,
    options?: { maxSteps?: number },
    toolRegistry?: IToolRegistry
  ): Promise<{ state: AgentState; result: RunResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    // maxSteps hierarchy: run parameter > RunnerOptions > default 10
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = state;
    let totalSteps = 0;

    while (totalSteps < maxSteps) {
      const { state: newState, result } = await this.step(currentState, registry);
      currentState = newState;
      totalSteps++;

      if (result.type === 'done') {
        return {
          state: currentState,
          result: { type: 'success', answer: result.answer, totalSteps },
        };
      }

      // result.type === 'continue' — loop again with updated state
    }

    return {
      state: currentState,
      result: { type: 'max_steps', totalSteps },
    };
  }

  /**
   * 🏃 Macro-step: Stream run until completion
   *
   * Loops stepStream() and yields cross-step events including real-time tokens.
   * Caller can break out at any time to interrupt.
   *
   * @param state - Current agent state
   * @param options - Optional run configuration (maxSteps)
   * @param toolRegistry - Optional tool registry override
   * @returns Async generator yielding RunStreamEvent, final return is { state, result }
   *
   * @example
   * ```typescript
   * for await (const event of runner.runStream(state)) {
   *   if (event.type === 'token') process.stdout.write(event.token);
   *   if (event.type === 'complete') console.log('\nDone:', event.result);
   * }
   * ```
   */
  async *runStream(
    state: AgentState,
    options?: { maxSteps?: number },
    toolRegistry?: IToolRegistry
  ): AsyncGenerator<RunStreamEvent, { state: AgentState; result: RunResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    // maxSteps hierarchy: run parameter > RunnerOptions > default 10
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = state;
    let totalSteps = 0;

    while (totalSteps < maxSteps) {
      yield { type: 'step:start', step: totalSteps, state: currentState };

      // Use stepStream to get real-time tokens and phase events
      const iterator = this.stepStream(currentState, registry);
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

      if (stepResult.result.type === 'done') {
        const runResult: RunResult = {
          type: 'success',
          answer: stepResult.result.answer,
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
}
