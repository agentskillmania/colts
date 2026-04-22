/**
 * @fileoverview Execution Policy type definitions
 *
 * Decouples stop conditions, error handling, and retry strategies
 * from AgentRunner.run() into an injectable interface.
 */

import type { AgentState } from '../types.js';
import type { StepResult, Action } from '../execution.js';

/**
 * Stop decision returned by IExecutionPolicy.shouldStop()
 */
export type StopDecision =
  | { decision: 'continue' }
  | {
      decision: 'stop';
      reason: string;
      runResultType: 'success' | 'error' | 'max_steps' | 'abort';
    };

/**
 * Tool error decision returned by IExecutionPolicy.onToolError()
 */
export type ToolErrorDecision =
  | { decision: 'fail'; error: Error }
  | { decision: 'continue'; sanitizedResult: unknown };

/**
 * Parse error decision returned by IExecutionPolicy.onParseError()
 */
export type ParseErrorDecision =
  | { decision: 'fail'; error: Error }
  | { decision: 'ignore'; fallbackText: string };

/**
 * Execution Policy interface
 *
 * Controls three decision points in the run loop:
 * 1. shouldStop - when to stop the run loop
 * 2. onToolError - how to handle tool execution errors
 * 3. onParseError - how to handle LLM response parse errors
 */
export interface IExecutionPolicy {
  /**
   * Decide whether to stop the run loop after a step
   *
   * @param state - Current agent state
   * @param stepResult - Result of the just-completed step
   * @param meta - Step count and configured max steps
   * @returns Stop or continue decision
   */
  shouldStop(
    state: AgentState,
    stepResult: StepResult,
    meta: { stepCount: number; maxSteps: number }
  ): StopDecision;

  /**
   * Handle a tool execution error
   *
   * @param error - The error that occurred during tool execution
   * @param action - The tool call that caused the error
   * @param state - Current agent state
   * @param meta - Retry count for this specific action
   * @returns Fail the run, or continue with a sanitized result
   */
  onToolError(
    error: Error,
    action: Action,
    state: AgentState,
    meta: { retryCount: number }
  ): ToolErrorDecision | Promise<ToolErrorDecision>;

  /**
   * Handle an LLM response parse error
   *
   * @param error - The error that occurred during parsing
   * @param rawResponse - The raw LLM response text
   * @param state - Current agent state
   * @param meta - Retry count for this specific parse attempt
   * @returns Fail the run, or ignore and treat as text response
   */
  onParseError(
    error: Error,
    rawResponse: string,
    state: AgentState,
    meta: { retryCount: number }
  ): ParseErrorDecision | Promise<ParseErrorDecision>;
}
