/**
 * @fileoverview AgentRunner - Stateless executor for AgentState
 *
 * Supports both blocking/streaming chat and fine-grained step control.
 * Configurable with dependency inversion and quick initialization.
 */

import { LLMClient } from '@agentskillmania/llm-client';
import type { TokenStats } from '@agentskillmania/llm-client';
import type { Message, Tool } from '@mariozechner/pi-ai';
import type {
  AgentState,
  ILLMProvider,
  IToolRegistry,
  IContextCompressor,
  CompressionConfig,
  LLMQuickInit,
} from './types.js';
import { ConfigurationError } from './types.js';
import { DefaultContextCompressor } from './compressor.js';
import { addUserMessage, addAssistantMessage, incrementStepCount } from './state.js';
import { ToolRegistry } from './tools/registry.js';
import type { Tool as ColtsTool } from './tools/registry.js';
import type {
  StepResult,
  AdvanceResult,
  ExecutionState,
  StreamEvent,
  RunResult,
  RunStreamEvent,
  Phase,
} from './execution.js';
import type { AdvanceOptions } from './execution.js';
import { createExecutionState, isTerminalPhase } from './execution.js';
import { buildMessages, getToolsForLLM } from './runner-message-builder.js';
import { compressState, maybeCompress } from './runner-compression.js';
import { executeAdvance } from './runner-advance.js';
import type { RunnerContext } from './runner-advance.js';
import { streamCallingLLM, executeAdvanceStream, executeStepStream, executeRunStream } from './runner-stream.js';
import type { ISkillProvider } from './skills/types.js';
import { FilesystemSkillProvider } from './skills/filesystem-provider.js';
import { createLoadSkillTool } from './skills/load-skill-tool.js';
import type { SubAgentConfig } from './subagent/types.js';
import { createDelegateTool } from './subagent/delegate-tool.js';
import { EventEmitter } from 'eventemitter3';

/**
 * Runner event map - flat naming, no nesting
 */
export interface RunnerEventMap {
  // Execution lifecycle
  'run:start': { state: AgentState };
  'run:end': { state: AgentState; result: RunResult };

  'step:start': { state: AgentState; stepNumber: number };
  'step:end': { state: AgentState; stepNumber: number; result: StepResult };

  'advance:phase': { from: Phase; to: Phase; state: AgentState };

  // Error events
  'error': { state: AgentState; error: Error; phase: 'run' | 'step' | 'advance' };

  // Execution details
  'llm:tokens': { tokens: string[] };
  'tool:call': { tool: string; arguments: unknown };
  'tool:result': { tool: string; result: unknown };
  'skill:load': { name: string };
  'compress:start': { state: AgentState };
  'compress:end': { state: AgentState; summary: string; removedCount: number };
}

/**
 * Configuration options for AgentRunner
 *
 * Supports both injection and quick initialization patterns
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

  /** Context compressor: pass CompressionConfig for built-in, or IContextCompressor for custom */
  compressor?: CompressionConfig | IContextCompressor;

  // --- Skills: injection or quick initialization ---
  /** Skill provider instance (injection mode) */
  skillProvider?: ISkillProvider;
  /** Skill directory list (quick init, creates FilesystemSkillProvider internally) */
  skillDirectories?: string[];

  // --- SubAgents ---
  /** Sub-agent configuration list, auto-registers delegate tool when provided */
  subAgents?: SubAgentConfig[];
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
export class AgentRunner extends EventEmitter<RunnerEventMap> {
  private llmProvider: ILLMProvider;
  private toolRegistry: IToolRegistry;
  private compressor?: IContextCompressor;
  private skillProvider?: ISkillProvider;
  private subAgentConfigs?: Map<string, SubAgentConfig>;
  private options: RunnerOptions;

  constructor(options: RunnerOptions) {
    super();
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
    const registry = options.toolRegistry ?? new ToolRegistry();
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

    // Initialize compressor
    if (options.compressor) {
      if (typeof options.compressor === 'object' && 'shouldCompress' in options.compressor) {
        this.compressor = options.compressor as IContextCompressor;
      } else {
        this.compressor = new DefaultContextCompressor(
          options.compressor as CompressionConfig,
          this.llmProvider,
          this.options.model
        );
      }
    }

    // Initialize skill provider (injection > quick init)
    if (options.skillProvider) {
      this.skillProvider = options.skillProvider;
    } else if (options.skillDirectories && options.skillDirectories.length > 0) {
      this.skillProvider = new FilesystemSkillProvider(options.skillDirectories);
    }

    // Auto-register load_skill tool
    if (this.skillProvider) {
      const loadSkillTool = createLoadSkillTool(this.skillProvider);
      this.toolRegistry.register(loadSkillTool);
    }

    // Initialize sub-agent configs and register delegate tool
    if (options.subAgents && options.subAgents.length > 0) {
      this.subAgentConfigs = new Map(options.subAgents.map((sa) => [sa.name, sa]));
      const delegateTool = createDelegateTool({
        subAgentConfigs: this.subAgentConfigs,
        llmProvider: this.llmProvider,
        parentToolRegistry: this.toolRegistry,
      });
      this.toolRegistry.register(delegateTool);
    }
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
    this.toolRegistry.register(tool);
  }

  /**
   * Unregister a tool at runtime
   */
  unregisterTool(name: string): boolean {
    return this.toolRegistry.unregister(name);
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
   * Build RunnerContext for extracted functions
   * @private
   */
  private get ctx(): RunnerContext {
    return {
      llmProvider: this.llmProvider,
      toolRegistry: this.toolRegistry,
      skillProvider: this.skillProvider,
      subAgentConfigs: this.subAgentConfigs,
      options: {
        model: this.options.model,
        systemPrompt: this.options.systemPrompt,
        requestTimeout: this.options.requestTimeout,
        maxSteps: this.options.maxSteps,
      },
    };
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
    return buildMessages(state, {
      systemPrompt: this.options.systemPrompt,
      model: this.options.model,
      skillProvider: this.skillProvider,
      subAgentConfigs: this.subAgentConfigs,
    });
  }

  private getToolsForLLM(registry?: IToolRegistry): Tool[] | undefined {
    return getToolsForLLM(registry);
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
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): Promise<AdvanceResult> {
    const from = execState.phase;
    try {
      const result = await executeAdvance(this.ctx, state, execState, toolRegistry, options);
      this.emit('advance:phase', { from, to: result.phase, state: result.state });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { state, error: err, phase: 'advance' });
      throw error;
    }
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
    registry?: IToolRegistry,
    signal?: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    yield* streamCallingLLM(this.ctx, state, execState, registry, signal);
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
    toolRegistry?: IToolRegistry,
    options?: AdvanceOptions
  ): AsyncGenerator<StreamEvent, AdvanceResult> {
    try {
      const generator = executeAdvanceStream(this.ctx, state, execState, toolRegistry, options);
      
      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          return value as AdvanceResult;
        }
        // Emit phase changes from stream events
        if (value.type === 'phase-change') {
          this.emit('advance:phase', { from: value.from, to: value.to, state });
        }
        yield value;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { state, error: err, phase: 'advance' });
      throw error;
    }
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
    toolRegistry?: IToolRegistry,
    options?: { signal?: AbortSignal },
    stepNumber?: number
  ): Promise<{ state: AgentState; result: StepResult }> {
    const registry = toolRegistry ?? this.toolRegistry;
    const execState = createExecutionState();
    const stepIdx = stepNumber ?? 0;
    
    this.emit('step:start', { state, stepNumber: stepIdx });
    
    // Loop advance() until a natural stopping point
    let currentState = state;
    
    try {
      while (!isTerminalPhase(execState.phase)) {
        options?.signal?.throwIfAborted();
        
        const from = execState.phase;
        const {
          state: newState,
          phase,
          done,
        } = await executeAdvance(this.ctx, currentState, execState, registry, options);
        
        currentState = await maybeCompress(this.compressor, newState);
        
        // Emit phase transition
        this.emit('advance:phase', { from, to: phase, state: currentState });

        // Terminal: completed (direct answer)
        if (done && phase.type === 'completed') {
          const result: StepResult = { type: 'done', answer: phase.answer };
          this.emit('step:end', { state: currentState, stepNumber: stepIdx, result });
          return { state: currentState, result };
        }

        // Terminal: error (LLM call failed)
        if (done && phase.type === 'error') {
          const result: StepResult = { type: 'error', error: phase.error };
          this.emit('step:end', { state: currentState, stepNumber: stepIdx, result });
          return { state: currentState, result };
        }

        // Non-terminal stopping point: tool-result
        if (phase.type === 'tool-result') {
          const result: StepResult = { type: 'continue', toolResult: phase.result };
          this.emit('step:end', { state: currentState, stepNumber: stepIdx, result });
          return { state: currentState, result };
        }
      }

      // Should not reach here
      throw new Error('Unexpected: step loop exited without reaching terminal phase');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { state: currentState, error: err, phase: 'step' });
      throw error;
    }
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
    toolRegistry?: IToolRegistry,
    options?: { signal?: AbortSignal },
    stepNumber?: number
  ): AsyncGenerator<StreamEvent, { state: AgentState; result: StepResult }> {
    const stepIdx = stepNumber ?? 0;
    this.emit('step:start', { state, stepNumber: stepIdx });
    try {
      const generator = executeStepStream(this.ctx, this.compressor, state, toolRegistry, options);
      
      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          const result = value as { state: AgentState; result: StepResult };
          this.emit('step:end', { state: result.state, stepNumber: stepIdx, result: result.result });
          return result;
        }
        // Forward stream events (including phase-change, token, tool events)
        // and emit phase changes as advance:phase events
        if (value.type === 'phase-change') {
          this.emit('advance:phase', { from: value.from, to: value.to, state });
        }
        yield value;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { state, error: err, phase: 'step' });
      throw error;
    }
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
    options?: { maxSteps?: number; signal?: AbortSignal },
    toolRegistry?: IToolRegistry
  ): Promise<{ state: AgentState; result: RunResult }> {
    this.emit('run:start', { state });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = state;
    let totalSteps = 0;

    try {
      while (totalSteps < maxSteps) {
        options?.signal?.throwIfAborted();
        
        // Call step() to get full event propagation (advance → step → run)
        const { state: newState, result } = await this.step(currentState, registry, options, totalSteps);
        currentState = newState;
        totalSteps++;

        if (result.type === 'done') {
          const runResult: RunResult = { type: 'success', answer: result.answer, totalSteps };
          this.emit('run:end', { state: currentState, result: runResult });
          return { state: currentState, result: runResult };
        }

        if (result.type === 'error') {
          const runResult: RunResult = { type: 'error', error: result.error, totalSteps };
          this.emit('error', { state: currentState, error: result.error, phase: 'step' });
          this.emit('run:end', { state: currentState, result: runResult });
          return { state: currentState, result: runResult };
        }

        // Auto-compress between steps
        if (this.compressor && this.compressor.shouldCompress(currentState)) {
          this.emit('compress:start', { state: currentState });
          const prevAnchor = currentState.context.compression?.anchor ?? 0;
          currentState = await maybeCompress(this.compressor, currentState);
          const newAnchor = currentState.context.compression?.anchor ?? 0;
          if (currentState.context.compression) {
            this.emit('compress:end', {
              state: currentState,
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
            });
          }
        }
      }

      // maxSteps exhausted
      const runResult: RunResult = { type: 'max_steps', totalSteps };
      this.emit('run:end', { state: currentState, result: runResult });
      return { state: currentState, result: runResult };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { state: currentState, error: err, phase: 'run' });
      throw error;
    }
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
    options?: { maxSteps?: number; signal?: AbortSignal },
    toolRegistry?: IToolRegistry
  ): AsyncGenerator<RunStreamEvent, { state: AgentState; result: RunResult }> {
    this.emit('run:start', { state });
    const registry = toolRegistry ?? this.toolRegistry;
    const maxSteps = options?.maxSteps ?? this.options.maxSteps ?? 10;
    let currentState = state;
    let totalSteps = 0;

    try {
      while (totalSteps < maxSteps) {
        options?.signal?.throwIfAborted();
        
        // Step start
        this.emit('step:start', { state: currentState, stepNumber: totalSteps });
        yield { type: 'step:start', step: totalSteps, state: currentState };

        // Use stepStream to get real-time tokens and phase events
        const iterator = executeStepStream(this.ctx, this.compressor, currentState, registry, options);
        let stepResult: { state: AgentState; result: StepResult };

        while (true) {
          const { done, value } = await iterator.next();
          if (done) {
            stepResult = value;
            break;
          }
          // Forward phase changes as advance:phase events
          if (value.type === 'phase-change') {
            this.emit('advance:phase', { from: value.from, to: value.to, state: currentState });
          }
          yield value as RunStreamEvent;
        }

        currentState = stepResult.state;
        this.emit('step:end', { state: currentState, stepNumber: totalSteps, result: stepResult.result });
        yield { type: 'step:end', step: totalSteps, result: stepResult.result };
        totalSteps++;

        // Auto-compress between steps
        if (this.compressor && this.compressor.shouldCompress(currentState)) {
          this.emit('compress:start', { state: currentState });
          yield { type: 'compressing' };
          const prevAnchor = stepResult.state.context.compression?.anchor ?? 0;
          currentState = await maybeCompress(this.compressor, currentState);
          const newAnchor = currentState.context.compression?.anchor ?? 0;
          if (currentState.context.compression) {
            this.emit('compress:end', {
              state: currentState,
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
            });
            yield {
              type: 'compressed',
              summary: currentState.context.compression.summary,
              removedCount: newAnchor - prevAnchor,
            };
          }
        }

        if (stepResult.result.type === 'done') {
          const runResult: RunResult = { type: 'success', answer: stepResult.result.answer, totalSteps };
          this.emit('run:end', { state: currentState, result: runResult });
          yield { type: 'complete', result: runResult };
          return { state: currentState, result: runResult };
        }

        if (stepResult.result.type === 'error') {
          const runResult: RunResult = { type: 'error', error: stepResult.result.error, totalSteps };
          this.emit('error', { state: currentState, error: stepResult.result.error, phase: 'step' });
          this.emit('run:end', { state: currentState, result: runResult });
          yield { type: 'complete', result: runResult };
          return { state: currentState, result: runResult };
        }
      }

      // maxSteps exhausted
      const runResult: RunResult = { type: 'max_steps', totalSteps };
      this.emit('run:end', { state: currentState, result: runResult });
      yield { type: 'complete', result: runResult };
      return { state: currentState, result: runResult };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { state: currentState, error: err, phase: 'run' });
      throw error;
    }
  }

  /**
   * Manually trigger context compression
   *
   * @param state - Current agent state
   * @returns New state with compression metadata (immutable)
   * @throws Error if no compressor is configured
   *
   * @example
   * ```typescript
   * const compressedState = await runner.compress(state);
   * // compressedState.context.compression is set
   * // compressedState.context.messages is unchanged
   * ```
   */
  async compress(state: AgentState): Promise<AgentState> {
    if (!this.compressor) {
      throw new Error('No compressor configured. Pass compressor in RunnerOptions.');
    }
    return compressState(this.compressor, state);
  }
}
