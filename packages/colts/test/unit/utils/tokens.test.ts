import { describe, it, expect } from 'vitest';
import { estimateTokens, addTokenStats } from '../../../src/utils/tokens.js';

describe('Token utilities', () => {
  it('estimateTokens should return positive count for non-empty text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('')).toBe(0);
  });

  it('addTokenStats should sum two TokenStats', () => {
    const a = { input: 10, output: 5 };
    const b = { input: 3, output: 7 };
    expect(addTokenStats(a, b)).toEqual({ input: 13, output: 12 });
  });

  it('addTokenStats should handle undefined gracefully', () => {
    expect(addTokenStats(undefined, undefined)).toEqual({ input: 0, output: 0 });
    expect(addTokenStats({ input: 5, output: 3 }, undefined)).toEqual({ input: 5, output: 3 });
  });
});
