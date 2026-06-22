/**
 * @fileoverview AgentState creation and updates
 *
 * Use Immer for immutable updates.
 * - All update operations return new state, original state remains unchanged
 */

import { randomUUID } from 'node:crypto';

import { produce, Draft } from 'immer';

import type { AgentState, AgentConfig, Message, TokenStats } from '../types.js';
import { generateId } from '../utils/id.js';
import { estimateTokens, addTokenStats } from '../utils/tokens.js';

/**
 * Create initial AgentState
 *
 * @param config - Agent configuration
 * @returns New AgentState (immutable)
 */

/** Add token usage to AgentContext.totalTokens */
export function updateTotalTokens(state: AgentState, usage: TokenStats): AgentState {
  return updateState(state, (draft) => {
    draft.context.totalTokens = addTokenStats(draft.context.totalTokens, usage);
  });
}

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
 * Add a user message to the conversation history
 *
 * @param state - Current state
 * @param content - Message content
 * @returns New state with the user message appended
 */
export function addUserMessage(state: AgentState, content: string): AgentState {
  return updateState(state, (draft) => {
    draft.context.messages.push({
      id: randomUUID(),
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
      id: randomUUID(),
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
 * @param options - Optional parameters (toolCallId, toolName)
 * @returns New state with the tool message appended
 */
export function addToolMessage(
  state: AgentState,
  content: string,
  options?: {
    toolCallId?: string;
    toolName?: string;
  }
): AgentState {
  return updateState(state, (draft) => {
    const msg: Message = {
      id: randomUUID(),
      role: 'tool',
      content,
      type: 'tool-result',
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    };
    if (options?.toolCallId) msg.toolCallId = options.toolCallId;
    if (options?.toolName) msg.toolName = options.toolName;
    draft.context.messages.push(msg);
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
