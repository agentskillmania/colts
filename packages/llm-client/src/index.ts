/**
 * @agentskillmania/llm-client
 *
 * A unified LLM client with multi-provider support, concurrency control,
 * priority queuing, and comprehensive token tracking.
 *
 * @remarks
 * This package provides a robust, production-ready client for interacting
 * with various Large Language Model (LLM) providers through a unified interface.
 *
 * ## Features
 *
 * - **Multi-Provider Support**: Works with OpenAI, Anthropic, and other providers
 *   through the pi-ai library
 *
 * - **Three-Level Concurrency Control**: Prevents cascading failures with
 *   independent limits at Provider → API Key → Model levels
 *
 * - **Priority Queue**: Higher priority requests are processed first,
 *   enabling latency-sensitive operations
 *
 * - **Automatic Retries**: Configurable exponential backoff for transient failures
 *
 * - **Streaming Support**: Real-time token-by-token responses with content accumulation
 *
 * - **Observability**: Rich events and statistics for monitoring and debugging
 *
 * - **Request Tracing**: Optional external request IDs for distributed tracing
 *
 * ## Basic Usage
 *
 * ```typescript
 * import { LLMClient } from '@agentskillmania/llm-client';
 *
 * const client = new LLMClient();
 *
 * // Register provider
 * client.registerProvider({
 *   name: 'openai',
 *   maxConcurrency: 10
 * });
 *
 * // Register API key
 * client.registerApiKey({
 *   key: 'sk-...',
 *   provider: 'openai',
 *   maxConcurrency: 3,
 *   models: [
 *     { modelId: 'gpt-4', maxConcurrency: 2 },
 *     { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 }
 *   ]
 * });
 *
 * // Non-streaming call
 * const response = await client.call({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 *
 * console.log(response.content);
 * console.log(response.tokens);
 * ```
 *
 * ## Streaming Usage
 *
 * ```typescript
 * for await (const event of client.stream({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   priority: 1
 * })) {
 *   if (event.type === 'text') {
 *     process.stdout.write(event.delta);
 *   }
 *   if (event.type === 'done') {
 *     console.log('\nTotal tokens:', event.roundTotalTokens);
 *   }
 * }
 * ```
 *
 * ## Observability
 *
 * ```typescript
 * // Listen to state events
 * client.on('state', (event) => {
 *   console.log(`[${event.requestId}] ${event.type}`);
 * });
 *
 * // Get current statistics
 * const stats = client.getStats();
 * console.log(`Queue: ${stats.queueSize}, Active: ${stats.activeRequests}`);
 * ```
 *
 * @packageDocumentation
 */

export { LLMClient, type LLMClientOptions } from './client.js';
export { RequestScheduler } from './scheduler.js';
export { PiAiAdapter, type AdapterConfig } from './adapter.js';

// Re-export all types
export type {
  /** Configuration for LLMClient default concurrency settings (base interface). */
  LLMClientConfig,
  /** Configuration for LLM providers. */
  ProviderConfig,
  /** Configuration for API keys with model constraints. */
  ApiKeyConfig,
  /** Concurrency constraint for a specific model. */
  ModelConstraint,
  /** Options for making LLM requests. */
  CallOptions,
  /** Options for configuring retry behavior. */
  RetryOptions,
  /** Response from non-streaming LLM calls. */
  LLMResponse,
  /** Events emitted during streaming responses. */
  StreamEvent,
  /** Token usage statistics. */
  TokenStats,
  /** Client statistics for monitoring. */
  ClientStats,
  /** Scheduler lifecycle events. */
  SchedulerEvent,
} from './types.js';
