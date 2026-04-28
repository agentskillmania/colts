/**
 * @fileoverview Three-Level Execution Control
 *
 * Phase-based execution state machine for fine-grained control.
 */

import type { AgentState, Message } from '../types.js';
import type { ToolCall } from '../parser/index.js';
import type { DelegateResult } from '../subagent/types.js';
import type { TokenStats } from '@agentskillmania/llm-client';
import { produce, type Draft } from 'immer';

// ---------------------------------------------------------------------------
// ToolPostEffect — lifecycle side effects produced by handler
// ---------------------------------------------------------------------------

/**
 * Describes a single side effect produced after handler processes a phase.
 *
 * Difference from old ToolPostEffect: no longer contains `step:*` control effects.
 * Control flow is determined by AdvanceResult's `phase` + `done`.
 */
export type ToolPostEffect =
  // Skill lifecycle
  | { type: 'skill:loading'; name: string; timestamp: number }
  | { type: 'skill:loaded'; name: string; tokenCount: number; timestamp: number }
  | { type: 'skill:start'; name: string; task: string; state: AgentState; timestamp: number }
  | { type: 'skill:end'; name: string; result: string; state: AgentState; timestamp: number }
  // SubAgent lifecycle
  | { type: 'subagent:start'; name: string; task: string; timestamp: number }
  | { type: 'subagent:end'; name: string; result: unknown; timestamp: number }
  // Tool completion
  | { type: 'tool:end'; result: unknown; callId?: string; timestamp: number }
  | { type: 'tools:end'; results: Record<string, unknown>; timestamp: number }
  // Error
  | { type: 'error'; error: Error; context: { step: number }; timestamp: number };

/**
 * Action extracted from LLM response (represents a tool call)
 */
export interface Action {
  /** Tool call ID */
  id: string;
  /** Tool name */
  tool: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

/**
 * Execution phase - represents current state in ReAct cycle
 */
export type Phase =
  | { type: 'idle' }
  | { type: 'preparing'; messages: Message[] }
  | { type: 'calling-llm' }
  | { type: 'streaming' }
  | { type: 'llm-response'; response: string }
  | { type: 'parsing' }
  | { type: 'parsed'; thought: string; action?: Action }
  | { type: 'executing-tool'; actions: Action[] }
  | { type: 'tool-result'; results: Record<string, unknown> }
  | { type: 'completed'; answer: string }
  | { type: 'error'; error: Error };

/**
 * Result of a single step (one ReAct cycle)
 */
export type StepResult =
  | { type: 'continue'; toolResult: unknown; actions: Action[]; tokens: TokenStats }
  | { type: 'done'; answer: string; tokens: TokenStats }
  | { type: 'error'; error: Error; tokens: TokenStats }
  | { type: 'abort'; tokens: TokenStats };

/**
 * Events emitted during step/advance stream
 */
export type StreamEvent =
  | { type: 'phase-change'; from: Phase; to: Phase; timestamp: number }
  | { type: 'token'; token: string; timestamp: number }
  | { type: 'tool:start'; action: Action; timestamp: number }
  | { type: 'tool:end'; result: unknown; callId?: string; timestamp: number }
  | { type: 'tools:start'; actions: Action[]; timestamp: number }
  | { type: 'tools:end'; results: Record<string, unknown>; timestamp: number }
  | { type: 'error'; error: Error; context: { toolName?: string; step: number }; timestamp: number }
  | { type: 'compressing'; timestamp: number }
  | { type: 'compressed'; summary: string; removedCount: number; timestamp: number }
  | { type: 'skill:loading'; name: string; timestamp: number }
  | { type: 'skill:loaded'; name: string; tokenCount: number; timestamp: number }
  | { type: 'skill:start'; name: string; task: string; state?: AgentState; timestamp: number }
  | { type: 'skill:end'; name: string; result: string; state?: AgentState; timestamp: number }
  | { type: 'subagent:start'; name: string; task: string; timestamp: number }
  | { type: 'subagent:end'; name: string; result: DelegateResult; timestamp: number }
  | {
      type: 'llm:request';
      messages: Array<{ role: string; content: string }>;
      tools: string[];
      skill: { current: string | null; stack: string[] } | null;
      timestamp: number;
    }
  | {
      type: 'llm:response';
      text: string;
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
      timestamp: number;
    }
  | { type: 'thinking'; content: string; timestamp: number };

/**
 * Options for advance execution
 */
export interface AdvanceOptions {
  /** Priority for LLM call (default: 0) */
  priority?: number;
  /** AbortSignal to cancel execution */
  signal?: AbortSignal;
}

/**
 * Result of advance() call
 */
export interface AdvanceResult {
  /** Updated state */
  state: import('../types.js').AgentState;
  /** Updated execution state (immutable) */
  execState: ExecutionState;
  /** Current execution phase (= execState.phase) */
  phase: Phase;
  /** Whether execution is complete */
  done: boolean;
  /** Side-effects produced by the handler (e.g. skill:start, tool:end) */
  effects?: ToolPostEffect[];
  /** Token usage from the LLM call (if any) */
  tokens?: TokenStats;
  /** Estimated token count of the context sent to LLM (if any) */
  estimatedContextSize?: number;
}

/**
 * Internal execution state for tracking across advance() calls
 * This is not stored in AgentState, but managed by the caller
 */
export interface ExecutionState {
  /** Current phase */
  phase: Phase;
  /** Messages prepared for LLM (pi-ai format) */
  preparedMessages?: import('@mariozechner/pi-ai').Message[];
  /** Raw LLM response content */
  llmResponse?: string;
  /** Native thinking from LLM API (e.g. Claude extended thinking) */
  llmThinking?: string;
  /** Extracted explicit thinking (may be empty if no thinking was provided) */
  thought?: string;
  /** Content with think tags removed */
  cleanedContent?: string;
  /** Tool call to execute (first action) */
  action?: Action;
  /** All tool calls from LLM response (for parallel execution support) */
  allActions?: Action[];
  /** Tool execution result */
  toolResult?: unknown;
  /** Accumulated tokens during streaming */
  accumulatedTokens?: string;
  /** Estimated token count of the prepared context */
  estimatedContextSize?: number;
  /** Token usage from the LLM call (if any) */
  tokens?: TokenStats;
}

/**
 * Create initial execution state
 *
 * @returns New execution state starting at the 'idle' phase
 */
export function createExecutionState(): ExecutionState {
  return {
    phase: { type: 'idle' },
  };
}

/**
 * Update execution state using Immer (immutable)
 *
 * @param execState - Current execution state (not modified)
 * @param recipe - Update function that can modify the draft
 * @returns New ExecutionState (immutable)
 */
export function updateExecState(
  execState: ExecutionState,
  recipe: (draft: Draft<ExecutionState>) => void
): ExecutionState {
  return produce(execState, recipe);
}

/**
 * Convert ToolCall to Action
 *
 * @param toolCall - Parsed tool call from LLM response
 * @returns Action representation for execution control
 */
export function toolCallToAction(toolCall: ToolCall): Action {
  return {
    id: toolCall.id,
    tool: toolCall.name,
    arguments: toolCall.arguments,
  };
}

/**
 * Check if phase is terminal (completed or error)
 *
 * @param phase - Current execution phase
 * @returns true if the phase represents a terminal state
 */
export function isTerminalPhase(phase: Phase): boolean {
  return phase.type === 'completed' || phase.type === 'error';
}

/**
 * Result of a complete run (multiple ReAct cycles)
 */
export type RunResult =
  | { type: 'success'; answer: string; totalSteps: number; tokens: TokenStats }
  | { type: 'max_steps'; totalSteps: number; tokens: TokenStats }
  | { type: 'error'; error: Error; totalSteps: number; tokens: TokenStats }
  | { type: 'abort'; totalSteps: number; tokens: TokenStats };

/**
 * Events emitted during runStream()
 */
export type RunStreamEvent =
  | { type: 'step:start'; step: number; state: import('../types.js').AgentState; timestamp: number }
  | { type: 'step:end'; step: number; result: StepResult; timestamp: number }
  | StreamEvent
  | { type: 'complete'; result: RunResult; timestamp: number };
