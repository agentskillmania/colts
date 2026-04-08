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
  /** Internal transition counter for immutability tracking */
  __transition?: number;
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
