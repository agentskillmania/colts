/**
 * @fileoverview AgentRunner - Step 1: Basic LLM Chat
 *
 * Stateless runner that executes AgentState with LLM integration.
 * Supports both blocking and streaming chat modes.
 */

import type { LLMClient, TokenStats } from '@agentskillmania/llm-client';
import type { Message, TextContent } from '@mariozechner/pi-ai';
import type { AgentState } from './types.js';
import { addUserMessage, addAssistantMessage, incrementStepCount } from './state.js';

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
}
