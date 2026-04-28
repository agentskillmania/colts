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
  // Skill state
  SkillState,
  SkillStackFrame,
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
export { DefaultContextCompressor } from './compressor/index.js';

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
} from './state/index.js';

// Parser
export {
  parseResponse,
  extractThinkingAndContent,
  requiresToolExecution,
  formatToolCalls,
  ParseError,
  type ToolCall,
  type ParseResult,
} from './parser/index.js';

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

// Tool Schema Formatter
export type { IToolSchemaFormatter } from './tools/schema-formatter.js';
export { DefaultToolSchemaFormatter } from './tools/schema-formatter.js';

// Runner
export {
  AgentRunner,
  type RunnerOptions,
  type RunnerEventMap,
  type ChatOptions,
  type ChatResult,
  type ChatStreamChunk,
} from './runner/index.js';

// Execution Control
export {
  createExecutionState,
  updateExecState,
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
} from './execution/index.js';

// Skills
export { FilesystemSkillProvider, createLoadSkillTool } from './skills/index.js';

// Subagent
export type {
  SubAgentConfig,
  DelegateResult,
  SubAgentStreamEvent,
  ISubAgentFactory,
} from './subagent/index.js';
export { createDelegateTool, DefaultSubAgentFactory } from './subagent/index.js';
export type { DelegateToolDeps } from './subagent/index.js';

// Execution Engine
export type { IPhaseHandler, PhaseHandlerContext } from './execution-engine/index.js';
export { PhaseRouter, createDefaultPhaseHandlers } from './execution-engine/index.js';
export {
  IdleHandler,
  PreparingHandler,
  CallingLLMHandler,
  LLMResponseHandler,
  ParsingHandler,
  ParsedHandler,
  ExecutingToolHandler,
  ToolResultHandler,
  CompletedHandler,
  ErrorHandler,
} from './execution-engine/index.js';

// Execution Policy
export type {
  IExecutionPolicy,
  StopDecision,
  ToolErrorDecision,
  ParseErrorDecision,
} from './policy/types.js';
export { DefaultExecutionPolicy } from './policy/default-policy.js';

// Middleware
export type {
  AgentMiddleware,
  AdvanceHookReturn,
  StepHookReturn,
  RunHookReturn,
  AfterRunHookReturn,
  BeforeAdvanceContext,
  AfterAdvanceContext,
  BeforeStepContext,
  AfterStepContext,
  BeforeRunContext,
  AfterRunContext,
} from './middleware/index.js';
export { MiddlewareExecutor } from './middleware/index.js';
