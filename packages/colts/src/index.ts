/**
 * @fileoverview colts - ReAct Agent Framework for Development and Debugging
 *
 * Step 0: AgentState Data Structure
 * Step 1: Basic LLM Chat
 * Step 2: Response Parser
 * Step 3: Tool Registry
 * Step 4: Step Control
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
  // Step 6: Configuration interfaces
  ILLMProvider,
  IToolRegistry,
  LLMQuickInit,
  ToolQuickInit,
} from './types.js';

export { ConfigurationError } from './types.js';

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

// Execution Control (Step 4-5)
export {
  createExecutionState,
  toolCallToAction,
  isTerminalPhase,
  type Phase,
  type Action,
  type StepResult,
  type StreamEvent,
  type AdvanceResult,
  type ExecutionState,
  type RunResult,
  type RunStreamEvent,
} from './execution.js';
