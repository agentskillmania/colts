/**
 * @fileoverview getToolsForLLM coverage tests
 */

import { describe, it, expect } from 'vitest';
import { getToolsForLLM } from '../../../src/tools/llm-format.js';
import { DefaultToolSchemaFormatter } from '../../../src/tools/schema-formatter.js';

describe('getToolsForLLM', () => {
  it('should return undefined when no registry provided', () => {
    const result = getToolsForLLM(undefined);
    expect(result).toBeUndefined();
  });

  it('should return undefined when registry is explicitly undefined', () => {
    const result = getToolsForLLM(undefined, new DefaultToolSchemaFormatter());
    expect(result).toBeUndefined();
  });

  it('should use default formatter when none provided', () => {
    const registry = {
      getAll: () => [],
    };
    const result = getToolsForLLM(registry as never);
    expect(result).toEqual([]);
  });

  it('should fallback to empty array when registry has no getAll', () => {
    const registry = {};
    const result = getToolsForLLM(registry as never, new DefaultToolSchemaFormatter());
    expect(result).toEqual([]);
  });
});
