/**
 * @fileoverview colts Core Type Definitions
 *
 * Pure data types for AgentState, runner configuration, and compression.
 */

// eslint-disable-next-line import/order
import type {
  TokenStats as LLMTokenStats,
  TextContent,
  ImageContent,
} from '@agentskillmania/llm-client';
export type TokenStats = LLMTokenStats;

/**
 * Message role
 *
 * `'system'` rows come in two kinds, told apart by `type`:
 * - no `type` → marker lines, timeline traces of session-level events
 *   (compression, model switches). Content is by convention a compact JSON
 *   string (`kind` + event metadata; see `addSystemMessage`); they are pure
 *   persisted history and never enter conversation requests through the
 *   message assembler (markers in the live region can still appear in the
 *   summarize LLM input — same as Rust).
 * - `type: 'system-reminder'` → legacy per-turn dynamic reminder rows, which
 *   the wrangler-side assembler replays into the LLM by merging into the
 *   preceding user message's `<system-reminder>` tail (see {@link MessageType}).
 * (R2P-105, aligned with Rust 0a3ec81; R2P-101b.)
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message type
 */
export type MessageType =
  | 'text'
  | 'thought'
  | 'action'
  | 'tool-result'
  /**
   * Legacy compatibility (Rust HEAD form): per-turn dynamic reminder rows
   * (time context) persisted by the old daemon between Rust 5120a3e and
   * 1f08b1f — current daemon no longer writes them (time is computed per
   * request by the wrangler-side assembler as the trailing dynamic
   * reminder's first line). role 'system' + this type → the wrangler-side
   * assembler replays them by merging into the preceding user message's
   * `<system-reminder>` tail; plain system marker rows never enter the LLM
   * context. The wire name must stay for old archive deserialization.
   * (R2P-101b, aligned with Rust 5120a3e/1f08b1f.)
   */
  | 'system-reminder'
  /**
   * Driving instruction the engine injects after a successful load_skill
   * (role 'user' — the task text, or the fallback English line). LLM
   * assembly is by role: such rows are still sent as ordinary user messages
   * (zero model-side change); the history rebuild (frontend fromHistory)
   * uses the marker to skip bubble rendering — the line is not a real user
   * utterance and must not cut the assistant turn (live/resume
   * isomorphism). Distinct from system-reminder rows: those are role
   * 'system' rows the assembler skips entirely.
   * (R2P-114, aligned with Rust 87a54aa MessageType::SkillDirective.)
   */
  | 'skill-directive';

/**
 * Conversation message
 */
export interface Message {
  /** Message role */
  role: MessageRole;
  /** Unique message identifier (UUID v4) */
  id: string;
  /**
   * Message content: plain text (legacy form — old archives stay wire- and
   * compat-identical) or multimodal parts (user messages with image
   * attachments; `file:` refs stay as refs in the archive — base64 is
   * materialized onto the wire copy only, right before the LLM call).
   * (R2P-107, aligned with Rust llm_client::Content.)
   */
  content: string | (TextContent | ImageContent)[];
  /** Message type */
  type?: MessageType;
  /** Timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Tool call ID (associates with assistant toolCall when role='tool') */
  toolCallId?: string;
  /** Tool name (identifies source tool when role='tool') */
  toolName?: string;
  /**
   * Marks a tool-result message as an error (ERR2).
   * When true, the message assembler flags it as isError so the LLM can
   * distinguish a failed/rejected tool call from a successful one.
   * Defaults to false (undefined treated as false) for backward compat.
   */
  isError?: boolean;
  /** Tool call metadata (carries LLM-initiated tool calls when role='assistant') */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Estimated token count of this message's content (via js-tiktoken) */
  tokenCount?: number;
  /**
   * Per-turn (per-run) usage summary, stamped by the runner at run end onto
   * the turn's LAST assistant message; the frontend's fromHistory restores
   * per-turn duration/token display from it.
   *
   * Not written for waiting-human endings (turn unfinished — the final run
   * after resume writes it once) or all-zero usage (command-interception
   * runs; absent means "no usage"). Old archives simply lack the key.
   * (R2P-106, aligned with Rust c904595.)
   */
  usage?: TurnUsage;
}

/**
 * Usage summary for one run (one conversation turn), stamped on the turn's
 * last assistant message via `Message.usage`.
 *
 * Field shape (camelCase JSON) is identical to the frontend skill-ui-state
 * `TurnUsage` and the Rust colts `TurnUsage` (serde camelCase). Unlike
 * {@link TokenStats} it carries the whole-turn duration.
 */
export interface TurnUsage {
  /** Input tokens consumed this turn */
  inputTokens: number;
  /** Output tokens generated this turn */
  outputTokens: number;
  /** Cache-read tokens this turn */
  cacheRead: number;
  /** Cache-write tokens this turn */
  cacheWrite: number;
  /** Whole-turn duration (ms, including tool execution) */
  durationMs: number;
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
  /**
   * V2 HITL: tool call IDs approved by the human.
   *
   * NOT consumed after use: HitlMiddleware only SKIPS re-confirmation for
   * ids present here (it never removes an entry), so an approval keeps
   * letting its tool call through on every later advance of the same
   * session. run()'s resume guard reads the same set as its "accounted for"
   * exemption — the entry is what keeps an approved-but-not-yet-executed
   * toolCall from being rejected as dangling. (R2P-108.)
   */
  hitlApprovals?: string[];
  /**
   * V2 HITL: unanswered human requests (terminal-state persistence).
   *
   * Written by the executing-tool handler when a run suspends with
   * waiting-human; persisted with the state so round switches / restarts
   * keep the pending questions. The responder (daemon /respond) injects
   * answers via respond() + removePendingInterrupt() and resumes.
   * Optional: legacy states without the field deserialize unchanged.
   */
  pendingInterrupts?: PendingInterrupt[];
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
import type { Message as LLMMessage, LLMTool } from '@agentskillmania/llm-client';
import type { ZodTypeAny } from 'zod';

import type { PendingInterrupt } from './hitl/types.js';
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
    requestTimeout?: number;
    thinkingEnabled?: boolean;
    temperature?: number;
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
    requestTimeout?: number;
    thinkingEnabled?: boolean;
    temperature?: number;
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
 *
 * Enumeration order is part of the contract: implementations MUST return
 * `toToolSchemas()` sorted by tool name. The wire `tools` array is the very
 * front of the provider prefix cache, so a non-deterministic order
 * invalidates the cache wholesale across requests. Sort by UTF-16 code unit
 * (the shared `compareByCodeUnit` util) — never `localeCompare`, whose
 * collation is host/locale-dependent. (Prefix-cache structural property,
 * R2P-101.)
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
   * MUST be sorted by tool name (prefix-cache contract, see the interface
   * doc and R2P-101): identical name sets must serialize identically on
   * every call and every host.
   *
   * @returns Array of tool schemas, sorted by tool name
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

// LLM 快速初始化配置类型已下放 llm-client（此处 re-export 保持兼容）
export type { LLMQuickInit, LLMProviderEntry, ModelEntry } from '@agentskillmania/llm-client';

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
  /** Compression threshold (default: 120) */
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
