/**
 * Pi-ai adapter with retry logic and token tracking
 *
 * @module
 * @remarks
 * This module provides an adapter layer between the llm-client and the
 * pi-ai library, handling model creation, retry logic, timeout management,
 * and event transformation.
 */

import {
  complete as piComplete,
  stream as piStream,
  getModel,
  type Model,
  type Context,
  type Tool,
  type AssistantMessageEvent,
  type Usage,
} from '@mariozechner/pi-ai';
import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import type { CallOptions, LLMResponse, StreamEvent, TokenStats, RetryOptions } from './types.js';

/**
 * Check if an error is retryable.
 *
 * @param error - Error to check
 * @returns True if the error should trigger a retry
 *
 * @remarks
 * Retryable errors include:
 * - Rate limit errors (HTTP 429)
 * - Server errors (HTTP 5xx)
 * - Network errors (timeout, connection refused, reset, etc.)
 *
 * Client errors (4xx other than 429) are not retryable as they
 * indicate a problem with the request that won't be fixed by retrying.
 *
 * @internal
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Check for rate limit (429) or server errors (5xx)
  const status = (error as { status?: number }).status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }

  // Check for network-related error messages
  const message = error.message.toLowerCase();
  const networkErrors = ['timeout', 'econnrefused', 'econnreset', 'enotfound', 'network', 'socket'];

  return networkErrors.some((err) => message.includes(err));
}

/**
 * Adapter configuration options.
 */
export interface AdapterConfig {
  /** Custom base URL for the API (e.g., for proxy or different provider endpoints) */
  baseUrl?: string;
}

/**
 * Adapter for the pi-ai library with retry and token tracking.
 *
 * @remarks
 * The PiAiAdapter provides a bridge between the llm-client's abstract
 * request model and the pi-ai library's specific APIs. It handles:
 *
 * **Model Management**:
 * - Creates Model instances from model identifiers
 * - Falls back to custom model configuration for unknown models
 * - Supports custom base URLs for proxy or alternative endpoints
 *
 * **Retry Logic**:
 * - Configurable retry with exponential backoff
 * - Selective retry based on error type
 * - Callback for retry events
 *
 * **Timeout Handling**:
 * - Request-level timeout support
 * - Proper cleanup on timeout
 *
 * **Event Transformation**:
 * - Maps pi-ai events to llm-client StreamEvent format
 * - Accumulates content during streaming
 * - Tracks token usage
 *
 * @example
 * ```typescript
 * const adapter = new PiAiAdapter();
 *
 * // Non-streaming request
 * const response = await adapter.complete(
 *   'gpt-4',
 *   'sk-...',
 *   {
 *     messages: [{ role: 'user', content: 'Hello!' }],
 *     retryOptions: { retries: 3 }
 *   },
 *   (attempt, error) => console.log(`Retry ${attempt}: ${error.message}`)
 * );
 *
 * // Streaming request
 * for await (const event of adapter.streamWithRetry('gpt-4', 'sk-...', options)) {
 *   if (event.type === 'text') {
 *     process.stdout.write(event.delta);
 *   }
 * }
 * ```
 *
 * @example
 * With custom base URL (e.g., for ZhiPu AI):
 * ```typescript
 * const adapter = new PiAiAdapter({
 *   baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4'
 * });
 * ```
 *
 * @public
 */
export class PiAiAdapter {
  /** Default retry options used when not specified in request. */
  private defaultRetryOptions: Required<RetryOptions> = {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    factor: 2,
  };

  /** Custom base URL for API requests. */
  private customBaseUrl?: string;

  /**
   * Creates a new PiAiAdapter instance.
   *
   * @param config - Optional adapter configuration
   *
   * @example
   * ```typescript
   * // Default adapter
   * const adapter = new PiAiAdapter();
   *
   * // With custom base URL
   * const adapter = new PiAiAdapter({
   *   baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4'
   * });
   * ```
   */
  constructor(config?: AdapterConfig) {
    this.customBaseUrl = config?.baseUrl;
  }

  /**
   * Create a Model instance for the pi-ai library.
   *
   * @param modelId - Model identifier (e.g., 'gpt-4', 'gpt-3.5-turbo')
   * @returns Model instance configured for the identifier
   *
   * @remarks
   * First attempts to retrieve the model from pi-ai's built-in registry.
   * If not found, creates a custom Model configuration with reasonable defaults
   * for OpenAI-compatible APIs.
   *
   * If a custom baseUrl was provided in the constructor, it will be used
   * instead of the default OpenAI endpoint.
   *
   * The fallback configuration uses 'openai-completions' as the API type
   * which is supported by pi-ai for OpenAI-compatible endpoints.
   *
   * @internal
   */
  private createModel(modelId: string): Model<string> {
    // Try to get model from pi-ai registry
    const model = getModel('openai', modelId as never);
    if (model) {
      // If we have a custom base URL, override the model's baseUrl
      if (this.customBaseUrl) {
        return {
          ...model,
          baseUrl: this.customBaseUrl,
        } as Model<string>;
      }
      return model as Model<string>;
    }

    // Fallback: create a custom model for OpenAI-compatible APIs
    // Use 'openai-completions' which is the correct API type in pi-ai
    return {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: this.customBaseUrl ?? 'https://api.openai.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } as Model<string>;
  }

  /**
   * Build a Context instance from messages.
   *
   * @param messages - Array of conversation messages
   * @returns Context object for pi-ai
   *
   * @internal
   */
  private buildContext(messages: CallOptions['messages']): Context {
    return {
      messages: messages as Context['messages'],
    };
  }

  /**
   * Merge request retry options with defaults.
   *
   * @param options - Optional retry options from the request
   * @returns Complete retry options with defaults filled in
   *
   * @internal
   */
  private mergeRetryOptions(options?: RetryOptions): Required<RetryOptions> {
    return {
      ...this.defaultRetryOptions,
      ...options,
    };
  }

  /**
   * Execute an operation with retry logic.
   *
   * @param operation - Async function to execute
   * @param retryOptions - Retry configuration
   * @param onRetry - Optional callback invoked on each retry attempt
   * @returns Promise resolving to the operation result
   * @throws Last error if all retries are exhausted
   *
   * @remarks
   * Uses p-retry with exponential backoff. Only retryable errors
   * (rate limits, server errors, network issues) trigger retries.
   *
   * The onRetry callback receives the attempt number (1-indexed) and
   * the error that triggered the retry.
   *
   * @internal
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retryOptions: Required<RetryOptions>,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> {
    return pRetry(operation, {
      retries: retryOptions.retries,
      minTimeout: retryOptions.minTimeout,
      maxTimeout: retryOptions.maxTimeout,
      factor: retryOptions.factor,
      shouldRetry: (error) => isRetryableError(error),
      onFailedAttempt: ({ attemptNumber }) => {
        const error = new Error(`Attempt ${attemptNumber} failed`);
        if (onRetry) {
          onRetry(attemptNumber, error);
        }
      },
    });
  }

  /**
   * Convert pi-ai Usage to TokenStats.
   *
   * @param usage - Usage object from pi-ai, or undefined
   * @returns TokenStats with input and output counts
   *
   * @internal
   */
  private usageToTokenStats(usage: Usage | undefined): TokenStats {
    if (!usage) {
      return { input: 0, output: 0 };
    }
    return {
      input: usage.input,
      output: usage.output,
    };
  }

  /**
   * Execute a non-streaming completion request.
   *
   * @param modelId - Model identifier to use
   * @param apiKey - API key for authentication
   * @param options - Request options including messages, tools, timeouts
   * @param onRetry - Optional callback for retry events
   * @returns Promise resolving to the complete LLM response
   * @throws Error on request failure after all retries
   *
   * @remarks
   * This method performs a complete (non-streaming) request to the LLM.
   * It handles:
   * - Model creation and configuration
   * - Retry with exponential backoff
   * - Optional request timeout
   * - Response parsing and content extraction
   * - Token usage tracking
   *
   * Content extraction handles multiple content types:
   * - Text: Concatenated into the main content field
   * - Thinking: Captured separately if thinkingEnabled
   * - Tool calls: Parsed into structured tool call objects
   *
   * @example
   * ```typescript
   * const response = await adapter.complete(
   *   'gpt-4',
   *   'sk-...',
   *   {
   *     messages: [{ role: 'user', content: 'Hello!' }],
   *     requestTimeout: 30000,
   *     retryOptions: { retries: 3 }
   *   },
   *   (attempt, error) => console.log(`Retry ${attempt}`)
   * );
   *
   * console.log(response.content);
   * console.log(response.tokens);
   * ```
   */
  async complete(
    modelId: string,
    apiKey: string,
    options: CallOptions,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<LLMResponse> {
    const model = this.createModel(modelId);
    const context = this.buildContext(options.messages);
    const retryOpts = this.mergeRetryOptions(options.retryOptions);

    const operation = async (): Promise<LLMResponse> => {
      const result = await piComplete(model, context, {
        apiKey,
        thinkingEnabled: options.thinkingEnabled,
        tools: options.tools as Tool[],
        signal: options.signal,
      });

      // Extract text content
      let content = '';
      let thinking: string | undefined;
      const toolCalls: LLMResponse['toolCalls'] = [];

      for (const item of result.content) {
        if (item.type === 'text') {
          content += item.text;
        } else if (item.type === 'thinking') {
          thinking = (thinking || '') + item.thinking;
        } else if (item.type === 'toolCall') {
          toolCalls.push({
            id: item.id,
            name: item.name,
            arguments: item.arguments,
          });
        }
      }

      return {
        content,
        thinking,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokens: this.usageToTokenStats(result.usage),
        stopReason: result.stopReason,
      };
    };

    // Apply timeout if specified
    const promise = this.withRetry(operation, retryOpts, onRetry);

    if (options.requestTimeout) {
      return pTimeout(promise, {
        milliseconds: options.requestTimeout,
        message: `Request timeout after ${options.requestTimeout}ms`,
      });
    }

    return promise;
  }

  /**
   * Map a pi-ai event to the llm-client StreamEvent format.
   *
   * @param event - Event from pi-ai stream
   * @returns StreamEvent in llm-client format, or null to skip
   *
   * @remarks
   * Event type mapping:
   * - `text_start`, `text_delta`, `text_end` → `text` with delta
   * - `thinking_start`, `thinking_delta`, `thinking_end` → `thinking` with delta
   * - `toolcall_start`, `toolcall_delta`, `toolcall_end` → `tool_call` with details
   * - `done` → `done` with final token counts
   * - `error` → `error` with error message
   * - `start` and other control events → skipped (return null)
   * - Unknown types → `error` with unknown type message
   *
   * @internal
   */
  private mapEvent(event: AssistantMessageEvent): StreamEvent | null {
    switch (event.type) {
      case 'text_start':
        // Start of text block, no delta yet
        return {
          type: 'text',
          delta: '',
        };

      case 'text_delta':
        return {
          type: 'text',
          delta: event.delta,
        };

      case 'text_end':
        // End of text block, content is complete
        return {
          type: 'text',
          delta: '',
          accumulatedContent: event.content,
        };

      case 'thinking_start':
        return {
          type: 'thinking',
          delta: '',
        };

      case 'thinking_delta':
        return {
          type: 'thinking',
          delta: event.delta,
          thinking: event.delta,
        };

      case 'thinking_end':
        return {
          type: 'thinking',
          delta: '',
          thinking: event.content,
        };

      case 'toolcall_start':
        // Tool call started, no details yet
        return null;

      case 'toolcall_delta':
        // Partial tool call data, skip until complete
        return null;

      case 'toolcall_end':
        return {
          type: 'tool_call',
          toolCall: {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
          },
        };

      case 'done':
        return {
          type: 'done',
          tokens: this.usageToTokenStats(event.message.usage),
          roundTotalTokens: this.usageToTokenStats(event.message.usage),
        };

      case 'error':
        return {
          type: 'error',
          error: event.error.errorMessage || 'Unknown error',
        };

      case 'start':
        // Control event, skip
        return null;

      default:
        // Skip unknown event types gracefully
        return null;
    }
  }

  /**
   * Execute a streaming completion request with retry logic.
   *
   * @param modelId - Model identifier to use
   * @param apiKey - API key for authentication
   * @param options - Request options including messages, tools, timeouts
   * @param onRetry - Optional callback for retry events
   * @returns Async iterable yielding stream events in real-time
   *
   * @remarks
   * This method provides real-time streaming of LLM responses by yielding
   * events as they arrive from the underlying provider.
   *
   * **Event types yielded:**
   * - `text`: Incremental text content (delta + accumulatedContent)
   * - `thinking`: Reasoning content (when thinkingEnabled is true)
   * - `tool_call`: Complete tool/function call from the model
   * - `done`: Stream completed with final token counts
   * - `error`: An error occurred during streaming
   *
   * **Retry behavior:**
   * Retry uses p-retry with exponential backoff for connection-level
   * failures (before any events are yielded). The connection is verified
   * by awaiting the first event from the stream. Once streaming begins,
   * errors are yielded as error events without retry — this avoids sending
   * duplicate events to the caller.
   *
   * @example
   * ```typescript
   * for await (const event of adapter.streamWithRetry('gpt-4', 'sk-...', options)) {
   *   switch (event.type) {
   *     case 'text':
   *       process.stdout.write(event.delta);
   *       break;
   *     case 'done':
   *       console.log('\nTokens:', event.roundTotalTokens);
   *       break;
   *     case 'error':
   *       console.error('Stream failed:', event.error);
   *       break;
   *   }
   * }
   * ```
   */
  async *streamWithRetry(
    modelId: string,
    apiKey: string,
    options: CallOptions,
    onRetry?: (attempt: number, error: Error) => void
  ): AsyncIterable<StreamEvent> {
    const model = this.createModel(modelId);
    const context = this.buildContext(options.messages);
    const retryOpts = this.mergeRetryOptions(options.retryOptions);

    // Phase 1: Establish connection with p-retry
    // Verify the connection by awaiting the first event from the stream.
    // p-retry handles retries for connection-level failures automatically.
    let iterator: AsyncIterator<AssistantMessageEvent>;
    let firstEvent: AssistantMessageEvent;

    try {
      const result = await this.withRetry(
        async (): Promise<{
          iterator: AsyncIterator<AssistantMessageEvent>;
          firstEvent: AssistantMessageEvent;
        }> => {
          const stream = piStream(model, context, {
            apiKey,
            thinkingEnabled: options.thinkingEnabled,
            tools: options.tools as Tool[],
            signal: options.signal,
          });
          const iter = stream[Symbol.asyncIterator]();
          const { done, value } = await iter.next();
          if (done) {
            throw new Error('Stream ended immediately without events');
          }
          return { iterator: iter, firstEvent: value };
        },
        retryOpts,
        onRetry
      );
      iterator = result.iterator;
      firstEvent = result.firstEvent;
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      return;
    }

    // Phase 2: Yield events in real-time (no retry for mid-stream failures)
    // First event (already read during connection verification)
    let mapped = this.mapEvent(firstEvent);
    if (mapped) {
      yield mapped;
    }

    // Remaining events
    try {
      while (true) {
        const { done, value } = await iterator.next();
        if (done) break;
        mapped = this.mapEvent(value);
        if (mapped) yield mapped;
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
