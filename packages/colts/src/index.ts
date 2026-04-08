/**
 * @fileoverview colts - 面向开发调试的 ReAct Agent 框架
 *
 * Step 0: AgentState 数据结构
 * 纯数据、可序列化、不可变
 */

export type {
  AgentState,
  AgentConfig,
  AgentContext,
  Message,
  MessageRole,
  MessageType,
  ToolDefinition,
  Snapshot,
} from './types.js';

export {
  createAgentState,
  updateState,
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  incrementStepCount,
  setLastToolResult,
  createSnapshot,
  restoreSnapshot,
  serializeState,
  deserializeState,
} from './state.js';
