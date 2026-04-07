/**
 * Type definitions for llm-client
 */

import type { Message, Tool } from '@mariozechner/pi-ai';

/**
 * Global concurrency configuration for LLMClient
 */
export interface LLMClientConfig {
  /** Default maximum concurrent requests for providers (default: 10) */
  defaultProviderConcurrency?: number;
  /** Default maximum concurrent requests for API keys (default: 5) */
  defaultKeyConcurrency?: number;
  /** Default maximum concurrent requests for models (default: 3) */
  defaultModelConcurrency?: number;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Provider name (e.g., 'openai', 'anthropic') */
  name: string;
  /** Maximum concurrent requests for this provider */
  maxConcurrency: number;
}

/**
 * Model constraint configuration
 */
export interface ModelConstraint {
  /** Model ID (e.g., 'gpt-4', 'claude-sonnet-4') */
  modelId: string;
  /** Maximum concurrent requests for this model under this API key */
  maxConcurrency: number;
}

/**
 * API Key configuration
 */
export interface ApiKeyConfig {
  /** The API key */
  key: string;
  /** Provider name */
  provider: string;
  /** Maximum concurrent requests for this key */
  maxConcurrency: number;
  /** Supported models with their constraints */
  models: ModelConstraint[];
}

/**
 * Retry options
 */
export interface RetryOptions {
  /** Number of retries (default: 3) */
  retries?: number;
  /** Initial retry delay in ms (default: 1000) */
  minTimeout?: number;
  /** Maximum retry delay in ms (default: 10000) */
  maxTimeout?: number;
  /** Exponential backoff factor (default: 2) */
  factor?: number;
}

/**
 * Options for calling the LLM
 */
export interface CallOptions {
  /** Model ID */
  model: string;
  /** Conversation messages */
  messages: Message[];
  /** Enable streaming (default: false) */
  stream?: boolean;
  /** Request priority - higher values are processed first (default: 0) */
  priority?: number;
  /** Timeout for the actual LLM request in ms */
  requestTimeout?: number;
  /** Total timeout including queue wait time in ms */
  totalTimeout?: number;
  /** Retry configuration */
  retryOptions?: RetryOptions;
  /** Enable thinking/reasoning mode */
  thinkingEnabled?: boolean;
  /** Available tools */
  tools?: Tool[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional external request ID for tracing (auto-generated if not provided) */
  requestId?: string;
}

/**
 * Token statistics
 */
export interface TokenStats {
  /** Input tokens */
  input: number;
  /** Output tokens */
  output: number;
}

/**
 * Stream event types
 */
export type StreamEventType = 'text' | 'thinking' | 'tool_call' | 'usage' | 'done' | 'error';

/**
 * Base stream event
 */
export interface StreamEvent {
  /** Event type */
  type: StreamEventType;
  /** Incremental content (delta) */
  delta?: string;
  /** Accumulated content from start to current */
  accumulatedContent?: string;
  /** Current token statistics */
  tokens?: TokenStats;
  /** Final round total tokens (only present when type is 'done') */
  roundTotalTokens?: TokenStats;
  /** Error message (only present when type is 'error') */
  error?: string;
  /** Tool call details (only present when type is 'tool_call') */
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  /** Thinking content (only present when type is 'thinking') */
  thinking?: string;
}

/**
 * Non-streaming response
 */
export interface LLMResponse {
  /** Response content */
  content: string;
  /** Token usage */
  tokens: TokenStats;
  /** Tool calls if any */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Thinking content if enabled */
  thinking?: string;
  /** Stop reason */
  stopReason: string;
}

/**
 * Client statistics for state transparency
 */
export interface ClientStats {
  /** Current queue size */
  queueSize: number;
  /** Number of active (in-flight) requests */
  activeRequests: number;
  /** Health status of each API key */
  keyHealth: Map<
    string,
    {
      success: number;
      fail: number;
      lastError?: string;
    }
  >;
  /** Per-provider active request counts */
  providerActiveCounts: Map<string, number>;
  /** Per-key active request counts */
  keyActiveCounts: Map<string, number>;
}

/**
 * Scheduler state event
 */
export interface SchedulerEvent {
  /** Event type */
  type: 'queued' | 'started' | 'retry' | 'completed' | 'failed';
  /** Request ID */
  requestId: string;
  /** Queue position (only for 'queued') */
  position?: number;
  /** Estimated wait time in ms (only for 'queued') */
  estimatedWait?: number;
  /** API key used (for 'started', 'completed', 'failed') */
  key?: string;
  /** Model used */
  model?: string;
  /** Retry attempt number (for 'retry') */
  attempt?: number;
  /** Error message (for 'retry', 'failed') */
  error?: string;
  /** Request duration in ms (for 'completed') */
  duration?: number;
  /** Token usage (for 'completed') */
  tokens?: TokenStats;
}

/**
 * Internal request wrapper
 */
export interface InternalRequest {
  /** Unique request ID */
  id: string;
  /** Request options */
  options: CallOptions;
  /** Resolve function for promise */
  resolve: (value: LLMResponse | AsyncIterable<StreamEvent>) => void;
  /** Reject function for promise */
  reject: (reason: Error) => void;
  /** Start time for timeout tracking */
  startTime: number;
  /** Total timeout in ms */
  totalTimeout: number;
}

/**
 * API key with usage tracking
 */
export interface TrackedApiKey extends ApiKeyConfig {
  /** Current active request count */
  activeCount: number;
  /** Success count */
  successCount: number;
  /** Failure count */
  failCount: number;
  /** Last error message */
  lastError?: string;
  /** Last used timestamp */
  lastUsed: number;
}

/**
 * Provider with usage tracking
 */
export interface TrackedProvider extends ProviderConfig {
  /** Current active request count */
  activeCount: number;
}
