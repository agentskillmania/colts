/**
 * @fileoverview Type definitions for @agentskillmania/llm-client.
 *
 * This module contains all type definitions, interfaces, and enums
 * used throughout the LLM client library.
 *
 * @module
 */

// ─── 自有消息/工具类型（平台无关，独立于 pi-ai）──────────────────
// 形状与 pi-ai 兼容：adapter 边界处可直接转换；上层不依赖 pi-ai 类型。

/** 文本内容块 */
export interface TextContent {
  type: 'text';
  text: string;
  textSignature?: string;
}

/** 思考内容块（原生 reasoning） */
export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  /** 被安全过滤时置真（密文存 thinkingSignature 供多轮续传） */
  redacted?: boolean;
}

/**
 * 图片内容块。
 *
 * 两种互斥形态：
 * - 内联：`data`（纯 base64，不含 `data:` 前缀）+ `mimeType` —— pi-ai 适配器
 *   序列化为 `image_url` 的 data URL 形态。
 * - 引用：`ref` = `file:<相对路径>` —— 锚定调用方的附件目录（如会话目录），
 *   由 runner 在发 LLM 前一刻物化为内联形态；存档与事件流只保留引用，
 *   永不内联 base64。未经物化的 ref 到达 wire 会得到 `data:undefined` ——
 *   物化器保证这不会发生。
 */
export interface ImageContent {
  type: 'image';
  /** 图片数据（纯 base64）。与 ref 二选一。 */
  data?: string;
  /** MIME 类型（data 形态必填，如 `image/png`）。 */
  mimeType?: string;
  /** `file:<相对路径>` 附件引用（见上）。与 data 二选一。 */
  ref?: string;
}

/** UserMessage / ToolResultMessage 的 content 联合形态 */
export type MultimodalContent = string | (TextContent | ImageContent)[];

/**
 * 把消息 content 降级为纯文本：图片 → `[image]` 占位，工具调用 →
 * `[toolCall:<name>]` 标记，思考块保留原文，各 part 以 `\n` 连接。
 * 事件载荷与压缩摘要用它，保证 base64 永不外泄。（对齐 Rust
 * llm_client::Content::plain_text；thinking/toolCall 形态是 TS 侧
 * pi-ai 形状的扩展。）
 */
export function contentToPlainText(
  content: string | (TextContent | ImageContent | ThinkingContent | ToolCallContent)[]
): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text;
        case 'image':
          return '[image]';
        case 'thinking':
          return part.thinking;
        case 'toolCall':
          return `[toolCall:${part.name}]`;
      }
    })
    .join('\n');
}

/** 工具调用内容块（别名 ToolCall 供兼容引用） */
export interface ToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}

/** 兼容别名（同 ToolCallContent） */
export type ToolCall = ToolCallContent;

/** 用户消息 */
export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

/** Token 用量（与 pi-ai Usage 形状兼容） */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

/** 停止原因 */
export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

/** 助手消息 */
export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  /** 兼容字段：pi-ai 适配器填充（api/provider/model），调用方可忽略 */
  api?: string;
  provider?: string;
  model?: string;
  responseModel?: string;
  responseId?: string;
  usage?: Usage;
  stopReason?: StopReason;
  errorMessage?: string;
  timestamp: number;
}

/** 工具结果消息 */
export interface ToolResultMessage<TDetails = unknown> {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

/** 会话消息联合（自有形状） */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 供给 LLM 的工具定义（JSON Schema 参数） */
export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ─── LLM 快速初始化配置（原定义于 colts，下放至此）──────────────

/** 单个模型条目 */
export interface ModelEntry {
  /** 模型标识 */
  modelId: string;
  /** 该模型在对应 API key 下的最大并发 */
  maxConcurrency?: number;
  /** 上下文窗口（token 数，覆盖 adapter 默认） */
  contextWindow?: number;
  /** 每次请求最大输出 token（覆盖 adapter 默认） */
  maxTokens?: number;
  /** 是否支持原生推理 */
  reasoning?: boolean;
  /** 支持的输入模态 */
  input?: string[];
}

/** 单个 provider 条目（一个 apiKey 对应一个 provider） */
export interface LLMProviderEntry {
  /** Provider 名 */
  name: string;
  /** 自定义 Base URL（可选） */
  baseUrl?: string;
  /** API key */
  apiKey: string;
  /** 该 provider 的最大并发（默认 5） */
  maxConcurrency?: number;
  /** 该 key 下可用的模型列表 */
  models: ModelEntry[];
}

/** 快速初始化：多 provider 配置（每 provider 一个 apiKey） */
export interface LLMQuickInit {
  /** 多个 LLM provider 配置 */
  providers: LLMProviderEntry[];
}

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
 *   defaultProviderConcurrency: 5,  // Max 5 concurrent requests per provider
 *   defaultKeyConcurrency: 5,        // Max 5 concurrent requests per API key
 *   defaultModelConcurrency: 3       // Max 3 concurrent requests per model
 * };
 * ```
 */
export interface LLMClientConfig {
  /**
   * Default maximum number of concurrent requests allowed per provider.
   *
   * @defaultValue 5
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

  /**
   * Base URL for this provider's API endpoint.
   *
   * @remarks
   * When set, requests routed to this provider use this endpoint instead
   * of the global LLMClient baseUrl. This allows a single LLMClient to
   * talk to multiple providers (e.g. OpenAI, ZhiPu, DeepSeek) at their
   * respective endpoints.
   *
   * @example 'https://api.openai.com/v1'
   */
  baseUrl?: string;
}

/**
 * Model metadata for context management.
 *
 * @remarks
 * Backward-compatible interface used by {@link LLMClient.getModelMeta}.
 * All capability fields are optional to avoid breaking existing callers.
 */
export interface ModelMeta {
  /** Maximum context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens per request */
  maxTokens: number;
  /** Whether the model supports native thinking/reasoning */
  reasoning?: boolean;
  /** Supported input modalities (e.g. ['text'], ['text', 'image']) */
  input?: string[];
}

/**
 * Resolved model capabilities with all fields required.
 *
 * @remarks
 * This is the strict version of {@link ModelMeta} where every field
 * is guaranteed to be present after merging pi-ai registry defaults
 * with user overrides.
 */
export interface ModelCapabilities {
  /** Maximum context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens per request */
  maxTokens: number;
  /** Whether the model supports native thinking/reasoning */
  reasoning: boolean;
  /** Supported input modalities (e.g. ['text'], ['text', 'image']) */
  input: string[];
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

  /**
   * Maximum context window size in tokens for this model.
   *
   * @remarks
   * If not set, defaults to 128000 in the adapter fallback.
   */
  contextWindow?: number;

  /**
   * Maximum output tokens per request for this model.
   *
   * @remarks
   * If not set, defaults to 16384 in the adapter fallback.
   */
  maxTokens?: number;

  /**
   * Whether the model supports native thinking/reasoning.
   *
   * @remarks
   * If not set, defaults to true in the adapter fallback.
   * Most modern models support reasoning; APIs that don't understand
   * thinking parameters silently ignore them.
   */
  reasoning?: boolean;

  /**
   * Supported input modalities for this model.
   *
   * @remarks
   * If not set, defaults to ['text'] in the adapter fallback.
   * Examples: ['text'], ['text', 'image'], ['text', 'image', 'audio']
   */
  input?: string[];
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

  /**
   * Custom base URL for this specific API key.
   *
   * @remarks
   * When set, it overrides the provider's baseUrl. Useful for proxies,
   * dedicated endpoints, or multi-region keys. If omitted, the provider's
   * baseUrl or the global LLMClient baseUrl is used.
   *
   * @example 'https://proxy.example.com/v1'
   */
  baseUrl?: string;
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
 * model selection, streaming behavior, timeouts, and retry policy.
 *
 * @example
 * ```typescript
 * const options: CallOptions = {
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: false,
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
  tools?: LLMTool[];

  /**
   * Sampling temperature for this request.
   *
   * @remarks
   * Controls randomness: lower values are more focused/deterministic,
   * higher values more creative. Range typically 0–2. If omitted, the
   * provider's default is used.
   */
  temperature?: number;

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
 * Tracks input (prompt) and output (completion) token counts, plus
 * cache read/write counts. These values are returned by the LLM provider's API.
 * When the provider does not return usage data, callers may fall back to
 * local estimation (see colts `estimateTokens`).
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

  /**
   * Number of input tokens served from the provider's prompt cache.
   *
   * @remarks
   * When the provider supports prompt caching (e.g. Anthropic), this is the
   * number of input tokens that were a cache hit (not billed at full rate).
   * Providers without caching support report 0.
   */
  cacheRead: number;

  /**
   * Number of input tokens written to the provider's prompt cache.
   *
   * @remarks
   * Tokens written to the cache for future reuse. Providers without caching
   * support report 0.
   */
  cacheWrite: number;
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
   * Current number of requests waiting in the queue.
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
