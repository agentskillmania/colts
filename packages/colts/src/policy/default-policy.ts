/**
 * @fileoverview Default Execution Policy
 *
 * Matches the current hardcoded behavior in AgentRunner.run():
 * - shouldStop: stops on done, error, or maxSteps reached
 * - onToolError: continues with error string (lets LLM retry)
 * - onParseError: fails the run (parse errors propagate up)
 */

import type {
  IExecutionPolicy,
  StopDecision,
  ToolErrorDecision,
  ParseErrorDecision,
} from './types.js';
import type { StepResult } from '../execution/index.js';

export class DefaultExecutionPolicy implements IExecutionPolicy {
  shouldStop(
    _state: unknown,
    stepResult: StepResult,
    meta: { stepCount: number; maxSteps: number }
  ): StopDecision {
    if (stepResult.type === 'done') {
      return {
        decision: 'stop',
        reason: stepResult.answer,
        runResultType: 'success',
      };
    }
    if (stepResult.type === 'error') {
      return {
        decision: 'stop',
        reason: stepResult.error.message,
        runResultType: 'error',
      };
    }
    if (stepResult.type === 'abort') {
      return {
        decision: 'stop',
        reason: 'Aborted',
        runResultType: 'abort',
      };
    }
    if (meta.stepCount >= meta.maxSteps) {
      return {
        decision: 'stop',
        reason: 'Max steps reached',
        runResultType: 'max_steps',
      };
    }
    return { decision: 'continue' };
  }

  onToolError(error: Error): ToolErrorDecision {
    // Current behavior: format error as string and pass to LLM as tool result
    return { decision: 'continue', sanitizedResult: `Error: ${error.message}` };
  }

  onParseError(error: Error): ParseErrorDecision {
    // Current behavior: parse errors cause the step to fail
    return { decision: 'fail', error };
  }
}
