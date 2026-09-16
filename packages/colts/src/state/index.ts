/**
 * @fileoverview AgentState creation and updates
 *
 * Use Immer for immutable updates.
 * - All update operations return new state, original state remains unchanged
 */

import { produce, Draft } from 'immer';

import type { AgentState, AgentConfig, Message, TokenStats } from '../types.js';
import { generateId } from '../utils/id.js';
import { estimateTokens, addTokenStats } from '../utils/tokens.js';

/** Add token usage to AgentContext.totalTokens */
export function updateTotalTokens(state: AgentState, usage: TokenStats): AgentState {
  return updateState(state, (draft) => {
    draft.context.totalTokens = addTokenStats(draft.context.totalTokens, usage);
  });
}

/**
 * Create initial AgentState
 *
 * @param config - Agent configuration
 * @returns New AgentState (immutable)
 */
export function createAgentState(config: AgentConfig): AgentState {
  const now = Date.now();
  return {
    id: generateId(),
    config,
    context: {
      messages: [],
      stepCount: 0,
      createdAt: now,
      updatedAt: now,
      totalTokens: undefined,
      estimatedContextSize: undefined,
    },
  };
}

/**
 * Update state using Immer
 *
 * @param state - Current state (not modified)
 * @param recipe - Update function that can modify the draft
 * @returns New AgentState (immutable)
 */
export function updateState(
  state: AgentState,
  recipe: (draft: Draft<AgentState>) => void
): AgentState {
  return produce(state, (draft) => {
    recipe(draft);
    draft.context.updatedAt = Date.now();
  });
}

/**
 * Add a user message to the conversation history.
 *
 * @param state - Current state
 * @param content - Message content
 * @param maxLength - Optional max character limit. Throws if exceeded.
 * @returns New state with the user message appended
 * @throws {Error} If content.length > maxLength
 */
export function addUserMessage(state: AgentState, content: string, maxLength?: number): AgentState {
  if (maxLength !== undefined && content.length > maxLength) {
    throw new Error(
      `Input exceeds maximum length of ${maxLength} characters (got ${content.length})`
    );
  }
  return updateState(state, (draft) => {
    draft.context.messages.push({
      id: globalThis.crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    });
  });
}

/**
 * Add an assistant message to the conversation history.
 *
 * @param state - Current state
 * @param content - Message content
 * @param options - Optional parameters (type, toolCalls)
 * @returns New state with the assistant message appended
 */
export function addAssistantMessage(
  state: AgentState,
  content: string,
  options?: {
    type?: Message['type'];
    toolCalls?: Message['toolCalls'];
  }
): AgentState {
  return updateState(state, (draft) => {
    const msg: Message = {
      id: globalThis.crypto.randomUUID(),
      role: 'assistant',
      content,
      type: options?.type ?? 'text',
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    };
    if (options?.toolCalls && options.toolCalls.length > 0) {
      msg.toolCalls = options.toolCalls;
    }
    draft.context.messages.push(msg);
  });
}

/**
 * Add a tool result message to the conversation history.
 *
 * @param state - Current state
 * @param content - Tool return content
 * @param options - Optional parameters (toolCallId, toolName, isError)
 * @returns New state with the tool message appended
 */
export function addToolMessage(
  state: AgentState,
  content: string,
  options?: {
    toolCallId?: string;
    toolName?: string;
    /** ERR2: mark the result as an error (rejection / failure), not a success */
    isError?: boolean;
  }
): AgentState {
  return updateState(state, (draft) => {
    const msg: Message = {
      id: globalThis.crypto.randomUUID(),
      role: 'tool',
      content,
      type: 'tool-result',
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    };
    if (options?.toolCallId) msg.toolCallId = options.toolCallId;
    if (options?.toolName) msg.toolName = options.toolName;
    if (options?.isError) msg.isError = true;
    draft.context.messages.push(msg);
  });
}

/**
 * Append a system marker row to the conversation history.
 *
 * Marker rows are timeline traces of session-level events (context
 * compression, model switches). The content is by convention a compact JSON
 * string (e.g. `{"kind":"compact",...}`) that consumers (frontend shims)
 * localize for display; the assembler always skips system rows, so markers
 * never enter conversation requests through the assembler — they are pure
 * persisted history, not conversation participants. (Markers in the live
 * region can still appear in the summarize LLM input — same as Rust.)
 * (R2P-105, aligned with Rust 0a3ec81 `add_system_message`.)
 *
 * @param state - Current state
 * @param content - Marker content (compact JSON string by convention)
 * @returns New state with the system marker appended
 */
export function addSystemMessage(state: AgentState, content: string): AgentState {
  return updateState(state, (draft) => {
    draft.context.messages.push({
      id: globalThis.crypto.randomUUID(),
      role: 'system',
      content,
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    });
  });
}

/**
 * Append a system-reminder row to the conversation history.
 *
 * Legacy compatibility (Rust HEAD form): the old daemon persisted one such
 * row per turn (frozen time context) between Rust 5120a3e and 1f08b1f; the
 * current daemon stopped writing them — time now lives in the wrangler-side
 * assembler's trailing dynamic reminder, computed per request. The row type
 * and writer are kept for old-archive deserialization and byte-stable
 * replay.
 *
 * The opposite of marker rows ({@link addSystemMessage}): reminder rows DO
 * enter the LLM context — the wrangler-side assembler merges them into the
 * preceding user message's `<system-reminder>` tail (the colts default
 * assembler skips them like every system row). The colts assembler never
 * synthesizes this content at request time, so replay is byte-stable and
 * prefix-cache-friendly. The frontend filters these rows by type, keeping
 * them out of the UI.
 * (R2P-101b, aligned with Rust 5120a3e/1f08b1f `add_system_reminder`.)
 *
 * @param state - Current state
 * @param content - Reminder content (frozen verbatim at write time)
 * @returns New state with the system-reminder row appended
 */
export function addSystemReminder(state: AgentState, content: string): AgentState {
  return updateState(state, (draft) => {
    draft.context.messages.push({
      id: globalThis.crypto.randomUUID(),
      role: 'system',
      content,
      type: 'system-reminder',
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    });
  });
}

/**
 * Increment the step counter
 *
 * @param state - Current state
 * @returns New state with stepCount incremented by one
 */
export function incrementStepCount(state: AgentState): AgentState {
  return updateState(state, (draft) => {
    draft.context.stepCount += 1;
  });
}

/**
 * Set the last tool execution result in context
 *
 * @param state - Current state
 * @param result - Tool execution result
 * @returns New state with lastToolResult set
 */
export function setLastToolResult(state: AgentState, result: unknown): AgentState {
  return updateState(state, (draft) => {
    draft.context.lastToolResult = result;
  });
}

/**
 * Proactively load a Skill into the state.
 *
 * Only sets the currently active skill (for UI display). Skill instructions are
 * NOT stored here — they persist in conversation history as `load_skill` tool
 * results, so they survive context switches and nested skill calls. The
 * `instructions` parameter is retained in the signature for caller compatibility
 * but is intentionally not persisted into state.
 *
 * @param state - Current AgentState
 * @param skillName - Skill name
 * @param _instructions - Skill instruction content (unused at the state layer; persisted via tool results)
 * @returns New AgentState (skillState.current updated)
 */
export function loadSkill(state: AgentState, skillName: string, _instructions: string): AgentState {
  return updateState(state, (draft) => {
    if (!draft.context.skillState) {
      draft.context.skillState = { current: null };
    }
    draft.context.skillState.current = skillName;
  });
}

/**
 * Serialize state to JSON
 *
 * @param state - AgentState to serialize
 * @returns JSON string representation
 */
export function serializeState(state: AgentState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize state from JSON or pass through an already-parsed object
 *
 * @param input - JSON string or already-parsed AgentState
 * @returns Parsed AgentState
 */
export function deserializeState(input: string | AgentState): AgentState {
  if (typeof input === 'string') {
    return JSON.parse(input) as AgentState;
  }
  return input;
}
