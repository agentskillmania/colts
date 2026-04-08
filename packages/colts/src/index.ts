/**
 * @fileoverview colts - ReAct Agent Framework for Development and Debugging
 *
 * Step 0: AgentState Data Structure
 * Step 1: Basic LLM Chat
 */

// Types
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

// State operations
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

// Runner
export {
  AgentRunner,
  type RunnerOptions,
  type ChatResult,
  type ChatStreamChunk,
} from './runner.js';
