import { describe, it, expect } from 'vitest';
import type { StepResult, RunResult } from '../../../src/execution/index.js';

describe('StepResult stopped variant', () => {
  it('accepts stopped type with optional data and tokens', () => {
    const result: StepResult = {
      type: 'stopped',
      data: { response: 'Command handled' },
      tokens: { input: 0, output: 0 },
    };
    expect(result.type).toBe('stopped');
    expect(result.data).toEqual({ response: 'Command handled' });
  });

  it('accepts stopped type without data', () => {
    const result: StepResult = {
      type: 'stopped',
      tokens: { input: 0, output: 0 },
    };
    expect(result.type).toBe('stopped');
    expect(result.data).toBeUndefined();
  });
});

describe('RunResult stopped variant', () => {
  it('accepts stopped type with optional data, totalSteps, and tokens', () => {
    const result: RunResult = {
      type: 'stopped',
      data: 'Command handled',
      totalSteps: 0,
      tokens: { input: 0, output: 0 },
    };
    expect(result.type).toBe('stopped');
    expect(result.data).toBe('Command handled');
  });

  it('accepts stopped type without data', () => {
    const result: RunResult = {
      type: 'stopped',
      totalSteps: 0,
      tokens: { input: 0, output: 0 },
    };
    expect(result.type).toBe('stopped');
    expect((result as { data?: unknown }).data).toBeUndefined();
  });
});
