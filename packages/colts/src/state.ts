/**
 * @fileoverview AgentState 创建和更新
 *
 * Step 0: AgentState 数据结构
 * - 使用 Immer 实现不可变更新
 * - 所有更新操作返回新状态，原状态保持不变
 */

import { produce, Draft } from 'immer';
import type { AgentState, AgentConfig, Message, Snapshot } from './types.js';

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 计算校验和（简单实现，生产环境可用更严格的算法）
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
 * 创建初始 AgentState
 *
 * @param config - Agent 配置
 * @returns 新的 AgentState（不可变）
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
 * 使用 Immer 更新状态
 *
 * @param state - 当前状态（不会被修改）
 * @param recipe - 更新函数（可修改 draft）
 * @returns 新的 AgentState（不可变）
 */
export function updateState(
  state: AgentState,
  recipe: (draft: Draft<AgentState>) => void
): AgentState {
  return produce(state, recipe);
}

/**
 * 添加用户消息
 *
 * @param state - 当前状态
 * @param content - 消息内容
 * @returns 新状态（包含新消息）
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
 * 添加助手消息
 *
 * @param state - 当前状态
 * @param content - 消息内容
 * @param options - 可选参数（类型、可见性）
 * @returns 新状态（包含新消息）
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
 * 添加工具消息
 *
 * @param state - 当前状态
 * @param content - 工具返回内容
 * @returns 新状态（包含新消息）
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
 * 增加步数计数器
 *
 * @param state - 当前状态
 * @returns 新状态（stepCount + 1）
 */
export function incrementStepCount(state: AgentState): AgentState {
  return updateState(state, (draft) => {
    draft.context.stepCount += 1;
  });
}

/**
 * 设置最后工具结果
 *
 * @param state - 当前状态
 * @param result - 工具执行结果
 * @returns 新状态
 */
export function setLastToolResult(state: AgentState, result: unknown): AgentState {
  return updateState(state, (draft) => {
    draft.context.lastToolResult = result;
  });
}

/**
 * 创建状态快照
 *
 * @param state - 当前状态
 * @returns 快照对象（可序列化）
 */
export function createSnapshot(state: AgentState): Snapshot {
  return {
    version: '1.0.0',
    timestamp: Date.now(),
    state: structuredClone(state), // 深拷贝确保隔离
    checksum: computeChecksum(state),
  };
}

/**
 * 从快照恢复状态
 *
 * @param snapshot - 快照对象
 * @returns 恢复的 AgentState
 * @throws 如果校验和不匹配
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
 * 序列化状态为 JSON
 *
 * @param state - AgentState
 * @returns JSON 字符串
 */
export function serializeState(state: AgentState): string {
  return JSON.stringify(state);
}

/**
 * 从 JSON 反序列化状态
 *
 * @param json - JSON 字符串
 * @returns AgentState
 */
export function deserializeState(json: string): AgentState {
  return JSON.parse(json) as AgentState;
}
