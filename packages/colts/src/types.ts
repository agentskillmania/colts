/**
 * @fileoverview colts Core Type Definitions
 *
 * Pure data types for AgentState, runner configuration, and compression.
 */

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message type
 */
export type MessageType = 'text' | 'thought' | 'action' | 'tool-result' | 'final';

/**
 * Conversation message
 */
export interface Message {
  /** 角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type?: MessageType;
  /** 时间戳 */
  timestamp?: number;
  /** 工具调用 ID（role='tool' 时关联到 assistant 的 toolCall） */
  toolCallId?: string;
  /** 工具名称（role='tool' 时标识来源工具） */
  toolName?: string;
  /** 工具调用元数据（role='assistant' 时携带 LLM 发起的工具调用） */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
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
}

/**
 * Skill stack frame for nested skill calling
 */
export interface SkillStackFrame {
  /** Name of the skill in this frame */
  skillName: string;
  /** Timestamp when this skill was loaded */
  loadedAt: number;
  /** Optional task context passed to the skill */
  taskContext?: unknown;
  /** Saved parent skill instructions, restored on return_skill */
  savedInstructions?: string;
}

/**
 * Skill state for nested skill calling
 * Stored in AgentContext to persist across steps and sessions
 */
export interface SkillState {
  /** Stack of parent skills (for return navigation) */
  stack: SkillStackFrame[];
  /** Currently active skill name */
  current: string | null;
  /** Cached instructions of current skill (to avoid re-loading) */
  loadedInstructions?: string;
  /** Available skills at top level (for load_skill tool) */
  availableSkills?: Array<{
    name: string;
    description: string;
  }>;
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

/**
 * State snapshot
 */
export interface Snapshot {
  /** Version number */
  version: string;
  /** Creation timestamp */
  timestamp: number;
  /** State data */
  state: AgentState;
  /** Checksum */
  checksum: string;
}

// ========== Runner Configuration Interfaces ==========

import type { ZodTypeAny } from 'zod';
import type { LLMResponse, StreamEvent } from '@agentskillmania/llm-client';
import type { Message as LLMMessage, Tool as LLMTool } from '@mariozechner/pi-ai';
import type { ToolSchema, Tool as LocalTool } from './tools/registry.js';

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
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent>;
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
}

/**
 * LLM Quick Initialization Configuration
 * When passed, Runner internally creates LLMClient instance
 */
export interface LLMQuickInit {
  /** API Key */
  apiKey: string;
  /** Provider name (default 'openai') */
  provider?: string;
  /** Custom Base URL (optional) */
  baseUrl?: string;
  /** Concurrency limit: max concurrent requests (default 5, applied to provider/key/model levels) */
  maxConcurrency?: number;
}

/**
 * Tool Quick Initialization Configuration
 * When passed, Runner internally creates ToolRegistry and registers tools
 */
export type ToolQuickInit = Array<{
  name: string;
  description: string;
  parameters: import('zod').ZodTypeAny;
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
export type CompressionStrategy = 'truncate' | 'sliding-window' | 'summarize' | 'hybrid';

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
  /** Compression strategy (default: 'sliding-window') */
  strategy?: CompressionStrategy;
  /** Number of recent messages to keep (default: 10) */
  keepRecent?: number;
}

// ========== Skill Interfaces ==========

export type { SkillManifest, ISkillProvider } from './skills/types.js';
