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

// Parser (Step 2)
export {
  parseResponse,
  requiresToolExecution,
  formatToolCalls,
  ParseError,
  type ToolCall,
  type ParseResult,
} from './parser.js';

// Tools (Step 3)
export {
  ToolRegistry,
  ToolNotFoundError,
  ToolParameterError,
  calculatorTool,
  type Tool,
  type ToolSchema,
} from './tools/index.js';

// Runner
export {
  AgentRunner,
  type RunnerOptions,
  type ChatOptions,
  type ChatResult,
  type ChatStreamChunk,
} from './runner.js';
