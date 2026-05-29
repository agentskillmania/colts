import { describe, it, expect } from 'vitest';
import type { ModelConstraint } from '../../src/types.js';

describe('ModelConstraint', () => {
  it('should accept optional metadata fields', () => {
    const constraint: ModelConstraint = {
      modelId: 'glm-5',
      maxConcurrency: 3,
      contextWindow: 200000,
      maxTokens: 131072,
      reasoning: true,
    };
    expect(constraint.modelId).toBe('glm-5');
    expect(constraint.contextWindow).toBe(200000);
    expect(constraint.maxTokens).toBe(131072);
    expect(constraint.reasoning).toBe(true);
  });

  it('should work with only required fields', () => {
    const constraint: ModelConstraint = {
      modelId: 'gpt-4',
      maxConcurrency: 2,
    };
    expect(constraint.contextWindow).toBeUndefined();
    expect(constraint.maxTokens).toBeUndefined();
    expect(constraint.reasoning).toBeUndefined();
  });
});
