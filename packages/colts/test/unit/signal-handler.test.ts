/**
 * @fileoverview applySkillSignal unit tests
 *
 * Tests the centralized skill signal handler covering all action types:
 * loaded, same-skill, cyclic-guard (legacy), not-found.
 *
 * Note: RETURN_SKILL handling was removed — skill instructions now persist
 * as the load_skill tool result content in conversation history.
 */

import { describe, it, expect } from 'vitest';
import { applySkillSignal, formatSkillToolResult } from '../../src/skills/signal-handler.js';
import type { AgentState, SkillState } from '../../src/types.js';
import type { SkillSignal } from '../../src/skills/types.js';

/**
 * Create a minimal AgentState for testing
 */
function createState(skillState?: SkillState): AgentState {
  return {
    id: 'test-agent',
    config: {
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    },
    context: {
      messages: [],
      stepCount: 0,
      skillState,
    },
  };
}

describe('applySkillSignal', () => {
  describe('SWITCH_SKILL', () => {
    it('should load first skill (no previous skillState)', () => {
      const state = createState(undefined);
      const signal: SkillSignal = {
        type: 'SWITCH_SKILL',
        to: 'greeting',
        instructions: 'Greet the user',
        task: 'Say hello',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('loaded');
      if (result.action === 'loaded') {
        expect(result.skillName).toBe('greeting');
      }

      const ss = newState.context.skillState!;
      expect(ss).toEqual(expect.any(Object));
      expect(ss.current).toBe('greeting');
    });

    it('should load first skill (empty skillState)', () => {
      const state = createState({ current: null });
      const signal: SkillSignal = {
        type: 'SWITCH_SKILL',
        to: 'greeting',
        instructions: 'Greet the user',
        task: 'Say hello',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('loaded');
      if (result.action === 'loaded') {
        expect(result.skillName).toBe('greeting');
      }
      expect(newState.context.skillState!.current).toBe('greeting');
    });

    it('should switch skill when a different skill is active', () => {
      const state = createState({
        current: 'greeting',
      });
      const signal: SkillSignal = {
        type: 'SWITCH_SKILL',
        to: 'tell-time',
        instructions: 'Tell the current time',
        task: 'What time is it?',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('loaded');
      if (result.action === 'loaded') {
        expect(result.skillName).toBe('tell-time');
      }

      const ss = newState.context.skillState!;
      expect(ss.current).toBe('tell-time');
    });

    it('should detect same-skill load (prevent self-reference)', () => {
      const state = createState({
        current: 'greeting',
      });
      const signal: SkillSignal = {
        type: 'SWITCH_SKILL',
        to: 'greeting',
        instructions: 'Greet the user',
        task: 'Same skill',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('same-skill');
      if (result.action === 'same-skill') {
        expect(result.currentSkill).toBe('greeting');
      }
      // State should be unchanged
      expect(newState.context.skillState!.current).toBe('greeting');
    });
  });

  describe('SKILL_NOT_FOUND', () => {
    it('should return not-found error', () => {
      const state = createState(undefined);
      const signal: SkillSignal = {
        type: 'SKILL_NOT_FOUND',
        requested: 'unknown-skill',
        available: ['greeting', 'tell-time'],
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('not-found');
      if (result.action === 'not-found') {
        expect(result.error.message).toContain('unknown-skill');
        expect(result.error.message).toContain('greeting');
        expect(result.error.message).toContain('tell-time');
      }
      // State should be unchanged
      expect(newState).toBe(state);
    });
  });
});

describe('formatSkillToolResult', () => {
  it('should format SWITCH_SKILL as instruction text', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'greeting',
      instructions: 'Greet warmly.',
      task: 'hi',
    });
    expect(result).toBe('Greet warmly.');
  });

  it('should stringify non-string instructions for SWITCH_SKILL', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'greeting',
      instructions: { body: 'hi' } as unknown as string,
      task: 'hi',
    });
    expect(result).toBe('{"body":"hi"}');
  });

  it('should format SKILL_NOT_FOUND', () => {
    const result = formatSkillToolResult({
      type: 'SKILL_NOT_FOUND',
      requested: 'missing',
      available: ['a', 'b'],
    });
    expect(result).toBe("Skill 'missing' not found");
  });

  it('should pass through non-signal string results', () => {
    expect(formatSkillToolResult('plain result')).toBe('plain result');
  });

  it('should stringify non-signal objects', () => {
    expect(formatSkillToolResult({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });
});
