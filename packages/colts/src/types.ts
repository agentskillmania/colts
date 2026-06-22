/**
 * @fileoverview colts Core Type Definitions
 *
 * Pure data types for AgentState, runner configuration, and compression.
 */

// eslint-disable-next-line import/order
import type { TokenStats as LLMTokenStats } from '@agentskillmania/llm-client';
export type TokenStats = LLMTokenStats;

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message type
 */
export type MessageType = 'text' | 'thought' | 'action' | 'tool-result';

/**
 * Conversation message
 */
export interface Message {
  /** Message role */
  role: MessageRole;
  /** Unique message identifier (UUID v4) */
  id: string;
  /** Message content */
  content: string;
  /** Message type */
  type?: MessageType;
  /** Timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Tool call ID (associates with assistant toolCall when role='tool') */
  toolCallId?: string;
  /** Tool name (identifies source tool when role='tool') */
  toolName?: string;
  /** Tool call metadata (carries LLM-initiated tool calls when role='assistant') */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Estimated token count of this message's content (via js-tiktoken) */
  tokenCount?: number;
}

/**
 * Tool definition
 */
export interface ToolDefinition {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Parameter JSON Schema */
  parameters?: Record<string, unknown>;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Agent name */
  name: string;
  /** System prompt / persona */
  instructions: string;
  /** Available tools list */
  tools: ToolDefinition[];
}

/**
 * Compression metadata stored in AgentContext
 *
 * Messages are never deleted. Compression only affects what buildMessages() sends to the LLM.
 */
export interface CompressionMeta {
  /** Summary text for messages[0..anchor-1] */
  summary: string;
  /** Boundary index: messages before this are summarized, not sent to LLM */
  anchor: number;
  /** Estimated token count of the summary text */
  summaryTokenCount?: number;
  /** Estimated token count of messages that were summarized */
  removedTokenCount?: number;
  /** When compression occurred */
  compressedAt?: number;
}

/**
 * Skill state — tracks the currently active skill for UI display.
 * Instructions live in conversation history (as load_skill tool results),
 * NOT here, so they persist across turns and survive context switches.
 */
export interface SkillState {
  /** Currently active skill name (for upper-layer display only) */
  current: string | null;
}

/**
 * Agent context
 */
export interface AgentContext {
  /** Conversation history (never deleted, compression only affects LLM view) */
  messages: Message[];
  /** Current execution step count */
  stepCount: number;
  /** Previous tool execution result (if any) */
  lastToolResult?: unknown;
  /** Compression metadata (present when context has been compressed) */
  compression?: CompressionMeta;
  /** Skill state for nested skill calling */
  skillState?: SkillState;
  /** State creation timestamp */
  createdAt: number;
  /** Last state mutation timestamp */
  updatedAt: number;
  /** Cumulative token usage across all LLM calls (exact values from provider) */
  totalTokens?: TokenStats;
  /** Estimated total token count of full LLM context (via js-tiktoken) */
  estimatedContextSize?: number;
  /** V2 HITL: tool call IDs approved by human (consumed after use by HitlMiddleware) */
  hitlApprovals?: string[];
}

/**
 * Agent state (pure data, immutable)
 *
 * Design principles:
 * 1. Pure data: no methods, only fields
 * 2. Serializable: can JSON.stringify/parse
 * 3. Immutable: use Immer for updates, original object unchanged
 */
export interface AgentState {
  /** Unique identifier */
  id: string;
  /** Configuration (immutable) */
  config: AgentConfig;
  /** Execution context */
  context: AgentContext;
}

// ========== Runner Configuration Interfaces ==========

import type { LLMResponse, StreamEvent, ModelMeta } from '@agentskillmania/llm-client';
import type { Message as LLMMessage, Tool as LLMTool } from '@mariozechner/pi-ai';
import type { ZodTypeAny } from 'zod';

import type { ToolSchema, Tool as LocalTool } from './tools/registry.js';

export type { SkillManifest, ISkillProvider } from './skills/types.js';

/**
 * LLM Provider Interface
 *
 * Runner interacts with LLM through this interface, not depending on concrete implementation.
 * The LLMClient from @agentskillmania/llm-client satisfies this interface.
 */
export interface ILLMProvider {
  /**
   * Blocking LLM call
   *
   * @param options - Call options including model, messages, and tools
   * @returns LLM response with content and token usage
   */
  call(options: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    priority?: number;
    requestTimeout?: number;
    thinkingEnabled?: boolean;
    signal?: AbortSignal;
  }): Promise<LLMResponse>;

  /**
   * Streaming LLM call
   *
   * @param options - Call options including model, messages, and tools
   * @returns Async iterable of stream events
   */
  stream(options: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    priority?: number;
    requestTimeout?: number;
    thinkingEnabled?: boolean;
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent>;

  /**
   * Get model metadata (context window size, max output tokens, capabilities).
   *
   * Used by runner for context-window-aware features like compression threshold
   * and by upstream consumers (wrangler, daemon) for diagnostics.
   *
   * @param modelId - Model identifier to query
   * @returns Model metadata, or a default if the model is unknown
   */
  getModelMeta(modelId: string): ModelMeta;
}

/**
 * Tool Registry Interface
 *
 * Runner executes tools and gets tool schemas through this interface.
 * The ToolRegistry class satisfies this interface.
 */
export interface IToolRegistry {
  /**
   * Execute specified tool
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param options - Optional execution options including abort signal
   * @returns Tool execution result
   */
  execute(name: string, args: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;

  /**
   * Get JSON schemas of all tools (for LLM)
   *
   * @returns Array of tool schemas
   */
  toToolSchemas(): ToolSchema[];

  /**
   * Register a new tool
   *
   * @param tool - Tool definition
   */
  register<T extends ZodTypeAny>(tool: {
    name: string;
    description: string;
    parameters: T;
    execute: (args: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
  }): void;

  /**
   * Unregister a tool by name
   *
   * @param name - Tool name
   * @returns true if the tool was removed
   */
  unregister(name: string): boolean;

  /**
   * Check if tool exists
   *
   * @param name - Tool name
   * @returns true if the tool is registered
   */
  has(name: string): boolean;

  /**
   * Get all registered tool names
   *
   * @returns Array of registered tool names
   */
  getToolNames(): string[];

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool definition or undefined if not found
   */
  get(name: string): LocalTool | undefined;

  /**
   * Get all registered tool definitions
   *
   * Used by IToolSchemaFormatter to convert tools for LLM consumption.
   * Optional: falls back to toToolSchemas() when not implemented.
   *
   * @returns Array of all registered tools
   */
  getAll?(): LocalTool[];
}

/**
 * Model entry for quick initialization.
 */
export interface ModelEntry {
  /** Model identifier */
  modelId: string;
  /** Max concurrent requests for this model under its API key */
  maxConcurrency?: number;
  /** Context window size in tokens (overrides adapter defaults) */
  contextWindow?: number;
  /** Max output tokens per request (overrides adapter defaults) */
  maxTokens?: number;
  /** Whether the model supports native reasoning */
  reasoning?: boolean;
  /** Supported input modalities */
  input?: string[];
}

/**
 * Provider entry for quick initialization.
 */
export interface LLMProviderEntry {
  /** Provider name */
  name: string;
  /** Custom base URL for this provider (optional) */
  baseUrl?: string;
  /** API key for this provider */
  apiKey: string;
  /** Max concurrent requests for this provider (default 5) */
  maxConcurrency?: number;
  /** Models available under this provider's API key */
  models: ModelEntry[];
}

/**
 * LLM Quick Initialization Configuration
 * When passed, Runner internally creates LLMClient instance
 */
export interface LLMQuickInit {
  /** Multiple LLM provider configurations */
  providers: LLMProviderEntry[];
}

/**
 * Tool Quick Initialization Configuration
 * When passed, Runner internally creates ToolRegistry and registers tools
 */
export type ToolQuickInit = Array<{
  name: string;
  description: string;
  parameters: ZodTypeAny;
  execute: (args: unknown) => Promise<unknown>;
}>;

/**
 * Configuration Error
 * Thrown when runner configuration is invalid
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ========== Context Compression Interfaces ==========

/**
 * Result of a compression operation
 */
export interface CompressResult {
  /** Summary text for the compressed messages */
  summary: string;
  /** Boundary index: messages[0..anchor-1] compressed, messages[anchor..] kept as-is */
  anchor: number;
  /** Estimated token count of the summary text */
  summaryTokenCount?: number;
  /** Estimated token count of messages that were summarized */
  removedTokenCount?: number;
  /** When compression occurred */
  compressedAt?: number;
  /** Messages whose tool output content was replaced with stubs */
  prunedMessages?: Array<{
    index: number;
    newContent: string;
    newTokenCount: number;
  }>;
}

/**
 * Context compressor interface (dependency inversion)
 *
 * Implementations check if compression is needed and produce compression metadata.
 * Messages are never modified — only the LLM's view changes.
 */
export interface IContextCompressor {
  /**
   * Check if compression is needed for the given state
   *
   * @param state - Current agent state
   * @returns true if compression should be triggered
   */
  shouldCompress(state: AgentState): boolean;

  /**
   * Execute compression, return metadata (does not modify messages)
   *
   * @param state - Current agent state
   * @returns Compression result with summary and anchor index
   */
  compress(state: AgentState): Promise<CompressResult>;
}

/**
 * Compression strategy
 */
export type CompressionStrategy = 'truncate' | 'summarize';

/**
 * Threshold type for compression trigger
 */
export type CompressionThresholdType = 'message-count' | 'estimated-tokens';

/**
 * Configuration for the built-in DefaultContextCompressor
 */
export interface CompressionConfig {
  /** Compression threshold (default: 50) */
  threshold?: number;
  /** Threshold type (default: 'message-count') */
  thresholdType?: CompressionThresholdType;
  /** Compression strategy (default: 'truncate') */
  strategy?: CompressionStrategy;
  /** Number of recent messages to keep (default: 10) */
  keepRecent?: number;
  /** Model for summary generation (defaults to the main model) */
  summaryModel?: string;
  /** LLM provider for summary generation (defaults to the main provider) */
  summaryProvider?: ILLMProvider;
  /** Model context window size in tokens (for percentage-based triggering) */
  contextWindowSize?: number;
  /** Minimum token count for a tool output to be pruned (default: 150) */
  pruneThreshold?: number;
}

// ========== Skill Interfaces ==========
