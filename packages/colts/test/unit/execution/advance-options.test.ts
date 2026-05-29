import { describe, it, expect } from 'vitest';
import type { AdvanceOptions } from '../../../src/execution/index.js';

describe('AdvanceOptions', () => {
  it('should accept thinkingEnabled field', () => {
    const opts: AdvanceOptions = {
      thinkingEnabled: true,
      priority: 1,
    };
    expect(opts.thinkingEnabled).toBe(true);
  });

  it('should work without thinkingEnabled', () => {
    const opts: AdvanceOptions = {
      priority: 0,
    };
    expect(opts.thinkingEnabled).toBeUndefined();
  });

  it('should accept thinkingEnabled as false', () => {
    const opts: AdvanceOptions = {
      thinkingEnabled: false,
      priority: 1,
    };
    expect(opts.thinkingEnabled).toBe(false);
  });

  it('should accept all optional fields together', () => {
    const opts: AdvanceOptions = {
      thinkingEnabled: true,
      priority: 5,
      signal: new AbortController().signal,
    };
    expect(opts.thinkingEnabled).toBe(true);
    expect(opts.priority).toBe(5);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
