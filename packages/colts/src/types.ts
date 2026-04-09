/**
 * @fileoverview colts Core Type Definitions
 *
 * Step 0: AgentState Data Structure
 * - Pure data, serializable, immutable
 * - Use Immer for immutable updates
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
  /** Role */
  role: MessageRole;
  /** Content */
  content: string;
  /** Message type */
  type?: MessageType;
  /** Whether visible externally (thought defaults to false) */
  visible?: boolean;
  /** Timestamp */
  timestamp?: number;
  /** Tool call ID (only used when role='tool') */
  toolCallId?: string;
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
 * Agent context
 */
export interface AgentContext {
  /** Conversation history */
  messages: Message[];
  /** Current execution step count */
  stepCount: number;
  /** Previous tool execution result (if any) */
  lastToolResult?: unknown;
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

// ========== Step 6: Runner Configuration Interfaces ==========

import type { LLMResponse, StreamEvent } from '@agentskillmania/llm-client';
import type { Message as LLMMessage, Tool } from '@mariozechner/pi-ai';
import type { ToolSchema } from './tools/registry.js';

/**
 * LLM Provider Interface
 *
 * Runner interacts with LLM through this interface, not depending on concrete implementation.
 * The LLMClient from @agentskillmania/llm-client satisfies this interface.
 */
export interface ILLMProvider {
  /** Blocking call */
  call(options: {
    model: string;
    messages: LLMMessage[];
    tools?: Tool[];
    priority?: number;
    requestTimeout?: number;
  }): Promise<LLMResponse>;

  /** Streaming call */
  stream(options: {
    model: string;
    messages: LLMMessage[];
    tools?: Tool[];
    priority?: number;
    requestTimeout?: number;
  }): AsyncIterable<StreamEvent>;
}

/**
 * Tool Registry Interface
 *
 * Runner executes tools and gets tool schemas through this interface.
 * The ToolRegistry class satisfies this interface.
 */
export interface IToolRegistry {
  /** Execute specified tool */
  execute(name: string, args: unknown): Promise<unknown>;
  /** Get JSON schemas of all tools (for LLM) */
  toToolSchemas(): ToolSchema[];
  /** Register a new tool */
  register<T extends import('zod').ZodTypeAny>(tool: {
    name: string;
    description: string;
    parameters: T;
    execute: (args: unknown) => Promise<unknown>;
  }): void;
  /** Unregister a tool by name */
  unregister(name: string): boolean;
  /** Check if tool exists */
  has(name: string): boolean;
  /** Get all registered tool names */
  getToolNames(): string[];
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
