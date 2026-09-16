/**
 * @fileoverview colts - ReAct Agent Framework for Development and Debugging
 *
 * Main entry point exporting types, state operations, tools, runner,
 * execution control, and skills.
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

  // Skill state
  SkillState,
  // Configuration interfaces
  ILLMProvider,
  IToolRegistry,
  LLMQuickInit,
  LLMProviderEntry,
  ModelEntry,
  ToolQuickInit,
  // Token usage
  TokenStats,
  TurnUsage,
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
  addSystemMessage,
  addSystemReminder,
  incrementStepCount,
  setLastToolResult,
  loadSkill,
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
  ToolSuspensionError,
  calculatorTool,
  createAskHumanTool,
  isAskSuspendSignal,
  ConfirmableRegistry,
  type Tool,
  type ToolSchema,
  type QuestionType,
  type Question,
  type Answer,
  type HumanResponse,
  type AskHumanHandler,
  type AskSuspendSignal,
  type ConfirmHandler,
  type ConfirmableRegistryOptions,
} from './tools/index.js';

// Tool Schema Formatter
export type { IToolSchemaFormatter } from './tools/schema-formatter.js';
export { DefaultToolSchemaFormatter } from './tools/schema-formatter.js';

// Message Assembler
export type { IMessageAssembler, BuildMessagesOptions } from './message-assembler/types.js';
export { DefaultMessageAssembler } from './message-assembler/default-assembler.js';

// Runner
export { AgentRunner, type RunnerOptions, type RunnerEventMap } from './runner/index.js';

// Per-request option types
export type { PerRequestOptions, StepOptions, RunOptions } from './runner/options.js';

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
export type { SkillFsOps } from './skills/fs-ops.js';
export { setDefaultSkillFsOps, getDefaultSkillFsOps } from './skills/fs-ops.js';

// NOTE: nodeFsOps is intentionally NOT exported from the main entry — it
// imports node:fs and would drag node: stubs into browser bundles. Import it
// from the '@agentskillmania/colts/skills/node-fs-ops' subpath instead.

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

// HITL V2 (Non-blocking Human-in-the-Loop)
export type {
  HumanRequest,
  HumanResponse as HitlHumanResponse,
  HumanQuestion,
  HumanAnswer,
  HitlConfig,
  PendingInterrupt,
} from './hitl/index.js';
export { HitlMiddleware } from './hitl/index.js';
export type { HitlMiddlewareOptions } from './hitl/index.js';
export { respond } from './hitl/index.js';
export {
  upsertPendingInterrupt,
  removePendingInterrupt,
  retargetToolCallId,
} from './hitl/index.js';
