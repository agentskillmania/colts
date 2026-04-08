/**
 * @fileoverview Step 4: Three-Level Execution Control
 *
 * Phase-based execution state machine for fine-grained control.
 */

import type { Message } from './types.js';
import type { ToolCall } from './parser.js';

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
  | { type: 'streaming'; token: string }
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
  | { type: 'done'; answer: string };

/**
 * Events emitted during step/advance stream
 */
export type StreamEvent =
  | { type: 'phase-change'; from: Phase; to: Phase }
  | { type: 'token'; token: string }
  | { type: 'tool:start'; action: Action }
  | { type: 'tool:end'; result: unknown };

/**
 * Options for advance execution
 */
export interface AdvanceOptions {
  /** Priority for LLM call (default: 0) */
  priority?: number;
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
 */
export function createExecutionState(): ExecutionState {
  return {
    phase: { type: 'idle' },
  };
}

/**
 * Convert ToolCall to Action
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
 */
export function isTerminalPhase(phase: Phase): boolean {
  return phase.type === 'completed' || phase.type === 'error';
}
