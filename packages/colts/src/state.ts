/**
 * @fileoverview AgentState creation and updates
 *
 * Use Immer for immutable updates.
 * - All update operations return new state, original state remains unchanged
 */

import { produce, Draft } from 'immer';
import type { AgentState, AgentConfig, Message, Snapshot } from './types.js';

/**
 * Generate unique ID
 *
 * @returns Unique identifier string
 */
function generateId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Compute checksum (simple implementation, production can use stricter algorithm)
 *
 * @param state - Agent state to checksum
 * @returns Hexadecimal checksum string
 */
function computeChecksum(state: AgentState): string {
  const data = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Create initial AgentState
 *
 * @param config - Agent configuration
 * @returns New AgentState (immutable)
 */
export function createAgentState(config: AgentConfig): AgentState {
  return {
    id: generateId(),
    config,
    context: {
      messages: [],
      stepCount: 0,
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
  return produce(state, recipe);
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
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  });
}

/**
 * Add an assistant message to the conversation history
 *
 * @param state - Current state
 * @param content - Message content
 * @param options - Optional parameters (type, visibility)
 * @returns New state with the assistant message appended
 */
export function addAssistantMessage(
  state: AgentState,
  content: string,
  options?: {
    type?: Message['type'];
    visible?: boolean;
  }
): AgentState {
  return updateState(state, (draft) => {
    draft.context.messages.push({
      role: 'assistant',
      content,
      type: options?.type ?? 'text',
      visible: options?.visible ?? true,
      timestamp: Date.now(),
    });
  });
}

/**
 * Add a tool result message to the conversation history
 *
 * @param state - Current state
 * @param content - Tool return content
 * @returns New state with the tool message appended
 */
export function addToolMessage(state: AgentState, content: string): AgentState {
  return updateState(state, (draft) => {
    draft.context.messages.push({
      role: 'tool',
      content,
      type: 'tool-result',
      timestamp: Date.now(),
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
 * Simulates the SWITCH_SKILL signal effect of the load_skill tool:
 * pushes the currently active skill onto the stack and sets the new skill as active.
 * buildMessages automatically injects loadedInstructions into the LLM system prompt.
 *
 * @param state - Current AgentState
 * @param skillName - Skill name
 * @param instructions - Skill instruction content (SKILL.md body)
 * @returns New AgentState (skillState updated)
 */
export function loadSkill(state: AgentState, skillName: string, instructions: string): AgentState {
  return updateState(state, (draft) => {
    if (!draft.context.skillState) {
      draft.context.skillState = { stack: [], current: null };
    }
    // If there is already an active skill, push it onto the stack (supports nesting)
    if (draft.context.skillState.current) {
      draft.context.skillState.stack.push({
        skillName: draft.context.skillState.current,
        loadedAt: Date.now(),
        savedInstructions: draft.context.skillState.loadedInstructions,
      });
    }
    draft.context.skillState.current = skillName;
    draft.context.skillState.loadedInstructions = instructions;
  });
}

/**
 * Create a state snapshot for time-travel or persistence
 *
 * @param state - Current state
 * @returns Snapshot object with checksum for integrity verification
 */
export function createSnapshot(state: AgentState): Snapshot {
  return {
    version: '1.0.0',
    timestamp: Date.now(),
    state: structuredClone(state), // Deep clone for isolation
    checksum: computeChecksum(state),
  };
}

/**
 * Restore state from snapshot
 *
 * @param snapshot - Snapshot object
 * @returns Restored AgentState
 * @throws If checksum mismatch
 */
export function restoreSnapshot(snapshot: Snapshot): AgentState {
  const restored = structuredClone(snapshot.state);
  const expectedChecksum = computeChecksum(restored);

  if (expectedChecksum !== snapshot.checksum) {
    throw new Error('Snapshot checksum mismatch: data may be corrupted');
  }

  return restored;
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
 * Deserialize state from JSON
 *
 * @param json - JSON string
 * @returns Parsed AgentState
 */
export function deserializeState(json: string): AgentState {
  return JSON.parse(json) as AgentState;
}
