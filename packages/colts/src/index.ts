/**
 * @fileoverview colts - ReAct Agent Framework for Development and Debugging
 *
 * Main entry point exporting types, state operations, tools, runner,
 * execution control, skills, and sub-agent capabilities.
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
  // Configuration interfaces
  ILLMProvider,
  IToolRegistry,
  LLMQuickInit,
  ToolQuickInit,
  // Context Compression
  CompressionMeta,
  CompressResult,
  IContextCompressor,
  CompressionStrategy,
  CompressionThresholdType,
  CompressionConfig,
  // Skill interfaces
  SkillManifest,
  ISkillProvider,
} from './types.js';

export { ConfigurationError } from './types.js';

// Context Compression
export { DefaultContextCompressor } from './compressor.js';

// State operations
export {
  createAgentState,
  updateState,
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  incrementStepCount,
  setLastToolResult,
  loadSkill,
  createSnapshot,
  restoreSnapshot,
  serializeState,
  deserializeState,
} from './state.js';

// Parser
export {
  parseResponse,
  requiresToolExecution,
  formatToolCalls,
  ParseError,
  type ToolCall,
  type ParseResult,
} from './parser.js';

// Tools
export {
  ToolRegistry,
  ToolNotFoundError,
  ToolParameterError,
  calculatorTool,
  createAskHumanTool,
  ConfirmableRegistry,
  type Tool,
  type ToolSchema,
  type QuestionType,
  type Question,
  type Answer,
  type HumanResponse,
  type AskHumanHandler,
  type ConfirmHandler,
  type ConfirmableRegistryOptions,
} from './tools/index.js';

// Runner
export {
  AgentRunner,
  type RunnerOptions,
  type RunnerEventMap,
  type ChatOptions,
  type ChatResult,
  type ChatStreamChunk,
} from './runner.js';

// Execution Control
export {
  createExecutionState,
  toolCallToAction,
  isTerminalPhase,
  type Phase,
  type Action,
  type StepResult,
  type StreamEvent,
  type AdvanceResult,
  type AdvanceOptions,
  type ExecutionState,
  type RunResult,
  type RunStreamEvent,
} from './execution.js';

// Skills
export { FilesystemSkillProvider, createLoadSkillTool } from './skills/index.js';

// Subagent
export type { SubAgentConfig, DelegateResult, SubAgentStreamEvent } from './subagent/index.js';
export { createDelegateTool } from './subagent/index.js';
export type { DelegateToolDeps } from './subagent/index.js';
