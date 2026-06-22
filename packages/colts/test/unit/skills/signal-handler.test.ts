/**
 * @fileoverview Skill signal handler branch coverage tests
 *
 * Covers:
 * - Unknown signal type fallback (exhaustive check)
 * - formatSkillToolResult with non-string SWITCH_SKILL instructions
 *
 * Note: RETURN_SKILL handling was removed — instructions now persist as
 * the load_skill tool result content.
 */

import { describe, it, expect } from 'vitest';
import { applySkillSignal, formatSkillToolResult } from '../../../src/skills/signal-handler.js';
import { createAgentState } from '../../../src/state/index.js';

describe('applySkillSignal', () => {
  it('should return not-found error for unknown signal type', () => {
    const state = createAgentState({
      config: { model: 'gpt-4', instructions: 'Test' },
      context: { messages: [] },
    });

    // Cast an invalid signal type to force the exhaustive fallback
    const unknownSignal = {
      type: 'UNKNOWN_SIGNAL_TYPE',
      someField: 'value',
    } as unknown as Parameters<typeof applySkillSignal>[1];

    const [newState, result] = applySkillSignal(state, unknownSignal);

    // State should be unchanged
    expect(newState).toBe(state);

    // Result should be not-found with descriptive error
    expect(result.action).toBe('not-found');
    if (result.action === 'not-found') {
      expect(result.error.message).toContain('Unknown signal type');
      expect(result.error.message).toContain('UNKNOWN_SIGNAL_TYPE');
    }
  });
});

describe('formatSkillToolResult', () => {
  it('should format SWITCH_SKILL with non-string instructions as JSON', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'summarize',
      instructions: { answer: '42', status: 'success' } as unknown as string,
      task: 'Summarize',
    });

    expect(result).toBe('{"answer":"42","status":"success"}');
  });

  it('should format SWITCH_SKILL with string instructions directly', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'tell-time',
      instructions: 'It is 2:30 PM',
      task: 'Get time',
    });

    expect(result).toBe('It is 2:30 PM');
  });
});
