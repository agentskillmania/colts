/**
 * @fileoverview Type definitions for @agentskillmania/llm-client.
 *
 * This module contains all type definitions, interfaces, and enums
 * used throughout the LLM client library.
 *
 * @module
 */

import type { Message, Tool } from '@mariozechner/pi-ai';

/**
 * Configuration options for LLMClient instance.
 *
 * @remarks
 * These settings define default concurrency limits that apply when
 * specific limits are not provided at the provider, key, or model level.
 *
 * @example
 * ```typescript
 * const config: LLMClientConfig = {
 *   defaultProviderConcurrency: 10,  // Max 10 concurrent requests per provider
 *   defaultKeyConcurrency: 5,        // Max 5 concurrent requests per API key
 *   defaultModelConcurrency: 3       // Max 3 concurrent requests per model
 * };
 * ```
 */
export interface LLMClientConfig {
  /**
   * Default maximum number of concurrent requests allowed per provider.
   *
   * @defaultValue 10
   */
  defaultProviderConcurrency?: number;

  /**
   * Default maximum number of concurrent requests allowed per API key.
   *
   * @defaultValue 5
   */
  defaultKeyConcurrency?: number;

  /**
   * Default maximum number of concurrent requests allowed per model.
   *
   * @defaultValue 3
   */
  defaultModelConcurrency?: number;
}

/**
 * Configuration for a single LLM provider.
 *
 * @remarks
 * A provider represents an LLM service (e.g., OpenAI, Anthropic) that
 * can host multiple models and API keys. The concurrency limit set here
 * applies to all requests made through this provider.
 *
 * @example
 * ```typescript
 * const provider: ProviderConfig = {
 *   name: 'openai',
 *   maxConcurrency: 10
 * };
 * ```
 */
export interface ProviderConfig {
  /**
   * Unique identifier for the provider.
   *
   * @example 'openai', 'anthropic', 'google'
   */
  name: string;

  /**
   * Maximum number of concurrent requests allowed for this provider.
   *
   * @remarks
   * This limit is enforced at the provider level, across all API keys
   * and models registered under this provider.
   */
  maxConcurrency: number;
}

/**
 * Concurrency constraint for a specific model under an API key.
 *
 * @remarks
 * Model constraints allow fine-grained control over how many concurrent
 * requests can be made to a specific model using a specific API key.
 *
 * @example
 * ```typescript
 * const constraint: ModelConstraint = {
 *   modelId: 'gpt-4',
 *   maxConcurrency: 2
 * };
 * ```
 */
export interface ModelConstraint {
  /**
   * Model identifier as recognized by the provider.
   *
   * @example 'gpt-4', 'gpt-3.5-turbo', 'claude-3-opus'
   */
  modelId: string;

  /**
   * Maximum concurrent requests for this model under the parent API key.
   *
   * @remarks
   * This limit is specific to the (API key, model) pair, allowing
   * different keys to have different limits for the same model.
   */
  maxConcurrency: number;
}

/**
 * Configuration for an API key with its associated models and constraints.
 *
 * @remarks
 * API keys are registered under a specific provider and can support
 * multiple models with individual concurrency limits. The scheduler
 * uses round-robin selection to distribute requests across available keys.
 *
 * @example
 * ```typescript
 * const apiKey: ApiKeyConfig = {
 *   key: 'sk-...',
 *   provider: 'openai',
 *   maxConcurrency: 5,
 *   models: [
 *     { modelId: 'gpt-4', maxConcurrency: 2 },
 *     { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 }
 *   ]
 * };
 * ```
 */
export interface ApiKeyConfig {
  /**
   * The actual API key string.
   *
   * @remarks
   * This should be kept secure and not logged or exposed in error messages.
   * The scheduler tracks key health statistics using a masked version of the key.
   */
  key: string;

  /**
   * Name of the provider this key belongs to.
   *
   * @remarks
   * The provider must be registered via {@link LLMClient.registerProvider}
   * before registering any API keys for it.
   */
  provider: string;

  /**
   * Maximum concurrent requests allowed for this API key across all models.
   *
   * @remarks
   * This limit applies across all models using this key, while individual
   * model constraints further limit concurrency per model.
   */
  maxConcurrency: number;

  /**
   * List of models supported by this API key with their concurrency constraints.
   *
   * @remarks
   * Only models listed here can be requested using this API key.
   * The scheduler filters available keys based on model support.
   */
  models: ModelConstraint[];
}

/**
 * Options for configuring retry behavior on failed requests.
 *
 * @remarks
 * Retry uses exponential backoff with configurable parameters.
 * Only retryable errors (rate limits, server errors, network issues)
 * trigger retries. Client errors (4xx) fail immediately.
 *
 * @example
 * ```typescript
 * const retryOptions: RetryOptions = {
 *   retries: 5,
 *   minTimeout: 1000,
 *   maxTimeout: 30000,
 *   factor: 2
 * };
 * ```
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts before giving up.
   *
   * @defaultValue 3
   */
  retries?: number;

  /**
   * Initial delay between retry attempts in milliseconds.
   *
   * @defaultValue 1000
   */
  minTimeout?: number;

  /**
   * Maximum delay between retry attempts in milliseconds.
   *
   * @remarks
   * The actual delay is calculated using exponential backoff but
   * capped at this value to prevent excessive wait times.
   *
   * @defaultValue 10000
   */
  maxTimeout?: number;

  /**
   * Exponential backoff factor.
   *
   * @remarks
   * Each retry delay is multiplied by this factor. For example,
   * with factor=2 and minTimeout=1000: delays are 1000, 2000, 4000...
   *
   * @defaultValue 2
   */
  factor?: number;
}

/**
 * Options for making a request to the LLM.
 *
 * @remarks
 * These options control all aspects of the request including
 * model selection, streaming behavior, timeouts, retry policy,
 * and request priority.
 *
 * @example
 * ```typescript
 * const options: CallOptions = {
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: false,
 *   priority: 1,
 *   requestTimeout: 30000,
 *   retryOptions: { retries: 3 }
 * };
 * ```
 */
export interface CallOptions {
  /**
   * Model identifier to use for this request.
   *
   * @example 'gpt-4', 'gpt-3.5-turbo', 'claude-3-opus'
   */
  model: string;

  /**
   * Array of conversation messages.
   *
   * @remarks
   * Messages should alternate between user and assistant roles.
   * The system message (if any) should be first.
   */
  messages: Message[];

  /**
   * Whether to enable streaming response.
   *
   * @remarks
   * When enabled, the response is returned as an async iterable
   * yielding partial content as it becomes available.
   *
   * @defaultValue false
   */
  stream?: boolean;

  /**
   * Request priority in the queue.
   *
   * @remarks
   * Higher priority requests are processed before lower priority ones.
   * Priority only affects queue ordering, not execution speed.
   *
   * @defaultValue 0
   */
  priority?: number;

  /**
   * Timeout for the actual LLM request in milliseconds.
   *
   * @remarks
   * This timeout applies to the API call itself, not including
   * queue wait time. For total timeout including queue, use totalTimeout.
   */
  requestTimeout?: number;

  /**
   * Total timeout including queue wait time in milliseconds.
   *
   * @remarks
   * This timeout encompasses the entire request lifecycle from
   * queue entry to completion. Use this when you need a hard deadline.
   */
  totalTimeout?: number;

  /**
   * Retry configuration for this specific request.
   *
   * @remarks
   * If not provided, default retry options are used.
   * Set to `{ retries: 0 }` to disable retries.
   */
  retryOptions?: RetryOptions;

  /**
   * Enable thinking/reasoning mode for supported models.
   *
   * @remarks
   * When enabled, the model may include reasoning content
   * in the response, accessible via the thinking field.
   *
   * @defaultValue false
   */
  thinkingEnabled?: boolean;

  /**
   * Available tools/functions for the model to call.
   *
   * @remarks
   * Tools allow the model to request external actions.
   * Tool calls are included in the response and must be handled
   * by the caller.
   */
  tools?: Tool[];

  /**
   * Abort signal for request cancellation.
   *
   * @remarks
   * The request can be cancelled at any point in its lifecycle
   * (queued, in-flight, or retrying) by aborting this signal.
   */
  signal?: AbortSignal;

  /**
   * Optional external request ID for tracing and observability.
   *
   * @remarks
   * If not provided, a unique ID is auto-generated.
   * This ID is included in all state events for correlation.
   */
  requestId?: string;
}

/**
 * Token usage statistics.
 *
 * @remarks
 * Tracks input (prompt) and output (completion) token counts.
 * These values are returned by the LLM provider's API.
 */
export interface TokenStats {
  /**
   * Number of input tokens consumed.
   *
   * @remarks
   * Includes all tokens in the messages sent to the model.
   */
  input: number;

  /**
   * Number of output tokens generated.
   *
   * @remarks
   * Includes all tokens in the model's response.
   */
  output: number;
}

/**
 * Types of events that can occur during streaming.
 */
export type StreamEventType = 'text' | 'thinking' | 'tool_call' | 'usage' | 'done' | 'error';

/**
 * Event emitted during streaming responses.
 *
 * @remarks
 * Streaming events provide real-time updates as the model generates
 * content. Events include both incremental (delta) and accumulated
 * content for flexible consumption patterns.
 *
 * @example
 * ```typescript
 * for await (const event of client.stream(options)) {
 *   switch (event.type) {
 *     case 'text':
 *       process.stdout.write(event.delta);
 *       break;
 *     case 'done':
 *       console.log('\nTotal tokens:', event.roundTotalTokens);
 *       break;
 *     case 'error':
 *       console.error('Error:', event.error);
 *       break;
 *   }
 * }
 * ```
 */
export interface StreamEvent {
  /**
   * Type of the stream event.
   */
  type: StreamEventType;

  /**
   * Incremental content (delta) since the last event.
   *
   * @remarks
   * Only present for text and thinking event types.
   * Use accumulatedContent for the full content so far.
   */
  delta?: string;

  /**
   * Accumulated content from the start of the stream to current.
   *
   * @remarks
   * This field provides the complete response text up to this point,
   * useful when you need the full content without manual accumulation.
   */
  accumulatedContent?: string;

  /**
   * Current token statistics.
   *
   * @remarks
   * Updated throughout the stream when usage information is available.
   * May be undefined for some event types.
   */
  tokens?: TokenStats;

  /**
   * Final token count for the entire round.
   *
   * @remarks
   * Only present when type is 'done'. Represents the total token
   * usage for this complete request/response cycle.
   */
  roundTotalTokens?: TokenStats;

  /**
   * Error message.
   *
   * @remarks
   * Only present when type is 'error'. Contains a description
   * of what went wrong.
   */
  error?: string;

  /**
   * Tool call details.
   *
   * @remarks
   * Only present when type is 'tool_call'. Contains the
   * function call requested by the model.
   */
  toolCall?: {
    /** Unique identifier for this tool call. */
    id: string;
    /** Name of the function being called. */
    name: string;
    /** Arguments passed to the function. */
    arguments: Record<string, unknown>;
  };

  /**
   * Thinking/reasoning content.
   *
   * @remarks
   * Only present when type is 'thinking' and thinkingEnabled
   * was set to true in the request options.
   */
  thinking?: string;
}

/**
 * Response from a non-streaming LLM call.
 *
 * @remarks
 * This is the complete response returned by {@link LLMClient.call}.
 * It includes the generated content, token usage, and any tool calls
 * or thinking content.
 */
export interface LLMResponse {
  /**
   * The generated response content.
   */
  content: string;

  /**
   * Token usage statistics for this request.
   */
  tokens: TokenStats;

  /**
   * Tool calls requested by the model.
   *
   * @remarks
   * Only present if tools were provided and the model decided
   * to invoke one or more of them. The caller must handle these
   * tool calls and potentially make a follow-up request.
   */
  toolCalls?: Array<{
    /** Unique identifier for this tool call. */
    id: string;
    /** Name of the function being called. */
    name: string;
    /** Arguments passed to the function. */
    arguments: Record<string, unknown>;
  }>;

  /**
   * Thinking/reasoning content.
   *
   * @remarks
   * Only present if thinkingEnabled was true and the model
   * provided reasoning content.
   */
  thinking?: string;

  /**
   * Reason why the model stopped generating.
   *
   * @example 'stop', 'length', 'tool_calls'
   */
  stopReason: string;
}

/**
 * Statistics and health information about the client state.
 *
 * @remarks
 * Retrieved via {@link LLMClient.getStats}, these statistics provide
 * real-time visibility into queue size, active requests, and API key health.
 *
 * @example
 * ```typescript
 * const stats = client.getStats();
 * console.log(`Queue: ${stats.queueSize}, Active: ${stats.activeRequests}`);
 * for (const [key, health] of stats.keyHealth) {
 *   console.log(`Key ${key}: ${health.success} success, ${health.fail} fail`);
 * }
 * ```
 */
export interface ClientStats {
  /**
   * Current number of requests waiting in the priority queue.
   */
  queueSize: number;

  /**
   * Number of requests currently being processed.
   */
  activeRequests: number;

  /**
   * Health statistics for each registered API key.
   *
   * @remarks
   * Keys are masked (first 8 chars + '...') for security.
   * Each entry tracks success count, failure count, and last error.
   */
  keyHealth: Map<
    string,
    {
      /** Number of successful requests. */
      success: number;
      /** Number of failed requests. */
      fail: number;
      /** Last error message if any. */
      lastError?: string;
    }
  >;

  /**
   * Current active request count per provider.
   */
  providerActiveCounts: Map<string, number>;

  /**
   * Current active request count per API key.
   */
  keyActiveCounts: Map<string, number>;
}

/**
 * Event emitted by the scheduler to track request lifecycle.
 *
 * @remarks
 * These events provide observability into the request journey
 * from queue entry through completion or failure.
 *
 * @example
 * ```typescript
 * client.on('state', (event: SchedulerEvent) => {
 *   console.log(`[${event.requestId}] ${event.type}`);
 *   if (event.type === 'queued') {
 *     console.log(`Position: ${event.position}`);
 *   }
 * });
 * ```
 */
export interface SchedulerEvent {
  /**
   * Type of lifecycle event.
   */
  type: 'queued' | 'started' | 'retry' | 'completed' | 'failed';

  /**
   * Unique identifier for the request.
   *
   * @remarks
   * This is either the requestId provided in CallOptions
   * or an auto-generated ID.
   */
  requestId: string;

  /**
   * Queue position (only for 'queued' events).
   *
   * @remarks
   * Position 0 means next to be processed.
   * Higher numbers indicate longer wait times.
   */
  position?: number;

  /**
   * Estimated wait time in milliseconds (only for 'queued' events).
   *
   * @remarks
   * This is a rough estimate based on average processing time
   * and current queue position.
   */
  estimatedWait?: number;

  /**
   * API key used (masked) for this request.
   *
   * @remarks
   * Present for 'started', 'completed', and 'failed' events.
   * The key is masked for security (first 8 chars + '...').
   */
  key?: string;

  /**
   * Model identifier used for this request.
   *
   * @remarks
   * Present for 'started' and related events.
   */
  model?: string;

  /**
   * Retry attempt number.
   *
   * @remarks
   * Only present for 'retry' events. Starts at 1 for the first retry.
   */
  attempt?: number;

  /**
   * Error message.
   *
   * @remarks
   * Present for 'retry' and 'failed' events. Contains
   * a description of what went wrong.
   */
  error?: string;

  /**
   * Request duration in milliseconds.
   *
   * @remarks
   * Only present for 'completed' events. Measures the time
   * from request start (after queue) to completion.
   */
  duration?: number;

  /**
   * Token usage statistics.
   *
   * @remarks
   * Only present for 'completed' events when available.
   */
  tokens?: TokenStats;
}

/**
 * Internal request wrapper for queue management.
 *
 * @remarks
 * This interface is used internally by the scheduler to wrap
 * requests with their promise resolvers and timeout tracking.
 *
 * @internal
 */
export interface InternalRequest {
  /**
   * Unique request identifier.
   */
  id: string;

  /**
   * Original call options.
   */
  options: CallOptions;

  /**
   * Promise resolve function.
   */
  resolve: (value: LLMResponse | AsyncIterable<StreamEvent>) => void;

  /**
   * Promise reject function.
   */
  reject: (reason: Error) => void;

  /**
   * Timestamp when the request was queued.
   */
  startTime: number;

  /**
   * Total timeout in milliseconds.
   */
  totalTimeout: number;
}

/**
 * API key with runtime tracking information.
 *
 * @remarks
 * Extends ApiKeyConfig with runtime statistics like active
 * request count, success/failure counters, and last used time.
 *
 * @internal
 */
export interface TrackedApiKey extends ApiKeyConfig {
  /**
   * Number of currently active requests using this key.
   */
  activeCount: number;

  /**
   * Total number of successful requests using this key.
   */
  successCount: number;

  /**
   * Total number of failed requests using this key.
   */
  failCount: number;

  /**
   * Last error message if any.
   */
  lastError?: string;

  /**
   * Timestamp of the last request using this key.
   */
  lastUsed: number;
}

/**
 * Provider with runtime tracking information.
 *
 * @remarks
 * Extends ProviderConfig with runtime statistics like
 * active request count.
 *
 * @internal
 */
export interface TrackedProvider extends ProviderConfig {
  /**
   * Number of currently active requests for this provider.
   */
  activeCount: number;
}
