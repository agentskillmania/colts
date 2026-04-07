/**
 * @agentskillmania/llm-client
 *
 * A unified LLM client with multi-provider support, concurrency control,
 * priority queuing, and comprehensive token tracking.
 *
 * @example
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
 *
 * // Streaming call
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
 */

export { LLMClient } from './client.js';
export { RequestScheduler } from './scheduler.js';
export { PiAiAdapter } from './adapter.js';

// Re-export all types
export type {
  ProviderConfig,
  ApiKeyConfig,
  ModelConstraint,
  CallOptions,
  RetryOptions,
  LLMResponse,
  StreamEvent,
  TokenStats,
  ClientStats,
  SchedulerEvent,
  LLMClientConfig,
} from './types.js';
