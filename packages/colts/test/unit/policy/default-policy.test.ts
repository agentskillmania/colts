/**
 * @fileoverview Unit tests for DefaultExecutionPolicy
 */

import { describe, it, expect } from 'vitest';
import { DefaultExecutionPolicy } from '../../../src/policy/default-policy.js';

describe('DefaultExecutionPolicy', () => {
  const policy = new DefaultExecutionPolicy();
  const dummyState = {} as never;

  // ── shouldStop ──

  describe('shouldStop', () => {
    it('should stop with success when step result is done', () => {
      const decision = policy.shouldStop(
        dummyState,
        { type: 'done', answer: 'Hello' },
        {
          stepCount: 1,
          maxSteps: 10,
        }
      );
      expect(decision).toEqual({
        decision: 'stop',
        reason: 'Hello',
        runResultType: 'success',
      });
    });

    it('should stop with error when step result is error', () => {
      const error = new Error('LLM call failed');
      const decision = policy.shouldStop(
        dummyState,
        { type: 'error', error },
        {
          stepCount: 3,
          maxSteps: 10,
        }
      );
      expect(decision).toEqual({
        decision: 'stop',
        reason: 'LLM call failed',
        runResultType: 'error',
      });
    });

    it('should stop with max_steps when stepCount >= maxSteps', () => {
      const decision = policy.shouldStop(
        dummyState,
        { type: 'continue', toolResult: 'ok', actions: [], tokens: { input: 0, output: 0 } },
        {
          stepCount: 10,
          maxSteps: 10,
        }
      );
      expect(decision).toEqual({
        decision: 'stop',
        reason: 'Max steps reached',
        runResultType: 'max_steps',
      });
    });

    it('should stop with max_steps when stepCount exceeds maxSteps', () => {
      const decision = policy.shouldStop(
        dummyState,
        { type: 'continue', toolResult: 'ok', actions: [], tokens: { input: 0, output: 0 } },
        {
          stepCount: 15,
          maxSteps: 10,
        }
      );
      expect(decision).toEqual({
        decision: 'stop',
        reason: 'Max steps reached',
        runResultType: 'max_steps',
      });
    });

    it('should continue when step result is continue and under maxSteps', () => {
      const decision = policy.shouldStop(
        dummyState,
        { type: 'continue', toolResult: 'ok', actions: [], tokens: { input: 0, output: 0 } },
        {
          stepCount: 5,
          maxSteps: 10,
        }
      );
      expect(decision).toEqual({ decision: 'continue' });
    });

    it('should continue when step result is continue and stepCount equals zero', () => {
      const decision = policy.shouldStop(
        dummyState,
        { type: 'continue', toolResult: 'ok', actions: [], tokens: { input: 0, output: 0 } },
        {
          stepCount: 0,
          maxSteps: 10,
        }
      );
      expect(decision).toEqual({ decision: 'continue' });
    });
  });

  // ── onToolError ──

  describe('onToolError', () => {
    it('should return continue with error string as sanitized result', () => {
      const error = new Error('Connection refused');
      const decision = policy.onToolError(
        error,
        { id: 'tc1', tool: 'db', arguments: {} },
        dummyState,
        {
          retryCount: 0,
        }
      );
      expect(decision).toEqual({
        decision: 'continue',
        sanitizedResult: 'Error: Connection refused',
      });
    });

    it('should handle non-standard error messages', () => {
      const error = new Error('Rate limit exceeded');
      const decision = policy.onToolError(
        error,
        { id: 'tc2', tool: 'api', arguments: {} },
        dummyState,
        {
          retryCount: 3,
        }
      );
      expect(decision).toEqual({
        decision: 'continue',
        sanitizedResult: 'Error: Rate limit exceeded',
      });
    });
  });

  // ── onParseError ──

  describe('onParseError', () => {
    it('should return fail with the original error', () => {
      const error = new Error('Invalid JSON in tool call arguments');
      const decision = policy.onParseError(error, '{"malformed', dummyState, {
        retryCount: 0,
      });
      expect(decision).toEqual({
        decision: 'fail',
        error,
      });
    });
  });
});
