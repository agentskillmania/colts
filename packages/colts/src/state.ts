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
 */
function generateId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Compute checksum (simple implementation, production can use stricter algorithm)
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
 * @param recipe - Update function (can modify draft)
 * @returns New AgentState (immutable)
 */
export function updateState(
  state: AgentState,
  recipe: (draft: Draft<AgentState>) => void
): AgentState {
  return produce(state, recipe);
}

/**
 * Add user message
 *
 * @param state - Current state
 * @param content - Message content
 * @returns New state (with new message)
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
 * Add assistant message
 *
 * @param state - Current state
 * @param content - Message content
 * @param options - Optional parameters (type, visibility)
 * @returns New state (with new message)
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
 * Add tool message
 *
 * @param state - Current state
 * @param content - Tool return content
 * @returns New state (with new message)
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
 * Increment step counter
 *
 * @param state - Current state
 * @returns New state (stepCount + 1)
 */
export function incrementStepCount(state: AgentState): AgentState {
  return updateState(state, (draft) => {
    draft.context.stepCount += 1;
  });
}

/**
 * Set last tool result
 *
 * @param state - Current state
 * @param result - Tool execution result
 * @returns New state
 */
export function setLastToolResult(state: AgentState, result: unknown): AgentState {
  return updateState(state, (draft) => {
    draft.context.lastToolResult = result;
  });
}

/**
 * 主动加载 Skill 到 state
 *
 * 模拟 load_skill 工具的 SWITCH_SKILL 信号效果：
 * 将当前活跃 skill 压栈，设置新 skill 为活跃状态。
 * buildMessages 会自动将 loadedInstructions 注入到 LLM 的 system prompt 中。
 *
 * @param state - 当前 AgentState
 * @param skillName - Skill 名称
 * @param instructions - Skill 指令内容（SKILL.md body）
 * @returns 新 AgentState（skillState 已更新）
 */
export function loadSkill(state: AgentState, skillName: string, instructions: string): AgentState {
  return updateState(state, (draft) => {
    if (!draft.context.skillState) {
      draft.context.skillState = { stack: [], current: null };
    }
    // 如果已有活跃 skill，压栈（支持嵌套）
    if (draft.context.skillState.current) {
      draft.context.skillState.stack.push({
        skillName: draft.context.skillState.current,
        loadedAt: Date.now(),
      });
    }
    draft.context.skillState.current = skillName;
    draft.context.skillState.loadedInstructions = instructions;
  });
}

/**
 * Create state snapshot
 *
 * @param state - Current state
 * @returns Snapshot object (serializable)
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
 * @param state - AgentState
 * @returns JSON string
 */
export function serializeState(state: AgentState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize state from JSON
 *
 * @param json - JSON string
 * @returns AgentState
 */
export function deserializeState(json: string): AgentState {
  return JSON.parse(json) as AgentState;
}
