import { describe, it, expect } from 'vitest';
import type { AdvanceOptions } from '../../../src/execution/index.js';

describe('AdvanceOptions', () => {
  it('should accept thinkingEnabled field', () => {
    const opts: AdvanceOptions = {
      thinkingEnabled: true,
    };
    expect(opts.thinkingEnabled).toBe(true);
  });

  it('should work without thinkingEnabled', () => {
    const opts: AdvanceOptions = {};
    expect(opts.thinkingEnabled).toBeUndefined();
  });

  it('should accept thinkingEnabled as false', () => {
    const opts: AdvanceOptions = {
      thinkingEnabled: false,
    };
    expect(opts.thinkingEnabled).toBe(false);
  });

  it('should accept all optional fields together', () => {
    const opts: AdvanceOptions = {
      thinkingEnabled: true,
      signal: new AbortController().signal,
    };
    expect(opts.thinkingEnabled).toBe(true);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
