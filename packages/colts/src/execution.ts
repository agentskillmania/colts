/**
 * @fileoverview Three-Level Execution Control
 *
 * Phase-based execution state machine for fine-grained control.
 */

import type { Message } from './types.js';
import type { ToolCall } from './parser.js';
import type { DelegateResult } from './subagent/types.js';

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
  | { type: 'executing-tool'; action: Action }
  | { type: 'tool-result'; result: unknown }
  | { type: 'completed'; answer: string }
  | { type: 'error'; error: Error };

/**
 * Result of a single step (one ReAct cycle)
 */
export type StepResult =
  | { type: 'continue'; toolResult: unknown }
  | { type: 'done'; answer: string }
  | { type: 'error'; error: Error };

/**
 * Events emitted during step/advance stream
 */
export type StreamEvent =
  | { type: 'phase-change'; from: Phase; to: Phase }
  | { type: 'token'; token: string }
  | { type: 'tool:start'; action: Action }
  | { type: 'tool:end'; result: unknown }
  | { type: 'error'; error: Error; context: { toolName?: string; step: number } }
  | { type: 'compressing' }
  | { type: 'compressed'; summary: string; removedCount: number }
  | { type: 'skill:loading'; name: string }
  | { type: 'skill:loaded'; name: string; tokenCount: number }
  | { type: 'skill:start'; name: string; task: string }
  | { type: 'skill:end'; name: string; result: string }
  | { type: 'subagent:start'; name: string; task: string }
  | { type: 'subagent:end'; name: string; result: DelegateResult };

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
  state: import('./types.js').AgentState;
  /** Current execution phase */
  phase: Phase;
  /** Whether execution is complete */
  done: boolean;
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
  /** Raw LLM response */
  llmResponse?: string;
  /** Parsed thought */
  thought?: string;
  /** Tool call to execute (first action) */
  action?: Action;
  /** All tool calls from LLM response (for parallel execution support) */
  allActions?: Action[];
  /** Tool execution result */
  toolResult?: unknown;
  /** Accumulated tokens during streaming */
  accumulatedTokens?: string;
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
  | { type: 'success'; answer: string; totalSteps: number }
  | { type: 'max_steps'; totalSteps: number }
  | { type: 'error'; error: Error; totalSteps: number };

/**
 * Events emitted during runStream()
 */
export type RunStreamEvent =
  | { type: 'step:start'; step: number; state: import('./types.js').AgentState }
  | { type: 'step:end'; step: number; result: StepResult }
  | StreamEvent
  | { type: 'complete'; result: RunResult };
