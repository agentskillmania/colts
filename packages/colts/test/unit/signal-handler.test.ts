/**
 * @fileoverview applySkillSignal unit tests
 *
 * Tests the centralized skill signal handler covering all action types:
 * loaded, returned, top-level-return, same-skill, cyclic, not-found.
 */

import { describe, it, expect } from 'vitest';
import {
  applySkillSignal,
  formatSkillToolResult,
  formatSkillAnswer,
} from '../../src/skills/signal-handler.js';
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
        expect(result.parentPushed).toBe(false);
      }

      const ss = newState.context.skillState!;
      expect(ss).toBeDefined();
      expect(ss.current).toBe('greeting');
      expect(ss.loadedInstructions).toBe('Greet the user');
      expect(ss.stack).toHaveLength(0);
    });

    it('should load first skill (empty skillState)', () => {
      const state = createState({ stack: [], current: null });
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
        expect(result.parentPushed).toBe(false);
      }
      expect(newState.context.skillState!.current).toBe('greeting');
    });

    it('should push parent and load nested skill', () => {
      const state = createState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user',
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
        expect(result.parentPushed).toBe(true);
      }

      const ss = newState.context.skillState!;
      expect(ss.current).toBe('tell-time');
      expect(ss.loadedInstructions).toBe('Tell the current time');
      expect(ss.stack).toHaveLength(1);
      expect(ss.stack[0].skillName).toBe('greeting');
      expect(ss.stack[0].savedInstructions).toBe('Greet the user');
    });

    it('should detect same-skill load (prevent self-reference)', () => {
      const state = createState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user',
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
      expect(newState.context.skillState!.stack).toHaveLength(0);
    });

    it('should detect cyclic load (prevent loops)', () => {
      const state = createState({
        stack: [{ skillName: 'greeting', loadedAt: Date.now() }],
        current: 'tell-time',
        loadedInstructions: 'Tell the time',
      });
      const signal: SkillSignal = {
        type: 'SWITCH_SKILL',
        to: 'greeting',
        instructions: 'Greet the user',
        task: 'Loop back',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('cyclic');
      if (result.action === 'cyclic') {
        expect(result.currentSkill).toBe('greeting');
      }
      // State should be unchanged
      expect(newState.context.skillState!.current).toBe('tell-time');
    });
  });

  describe('RETURN_SKILL', () => {
    it('should pop parent and restore on sub-skill return', () => {
      const state = createState({
        stack: [
          {
            skillName: 'greeting',
            loadedAt: Date.now(),
            savedInstructions: 'Greet the user',
          },
        ],
        current: 'tell-time',
        loadedInstructions: 'Tell the time',
      });
      const signal: SkillSignal = {
        type: 'RETURN_SKILL',
        result: 'It is 3:00 PM',
        status: 'success',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('returned');
      if (result.action === 'returned') {
        expect(result.parentName).toBe('greeting');
      }

      const ss = newState.context.skillState!;
      expect(ss.current).toBe('greeting');
      expect(ss.loadedInstructions).toBe('Greet the user');
      expect(ss.stack).toHaveLength(0);
    });

    it('should return top-level-return when stack is empty', () => {
      const state = createState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user',
      });
      const signal: SkillSignal = {
        type: 'RETURN_SKILL',
        result: 'Hello, world!',
        status: 'success',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('top-level-return');
      if (result.action === 'top-level-return') {
        expect(result.skillName).toBe('greeting');
      }

      // Current should be cleared
      expect(newState.context.skillState!.current).toBeNull();
      expect(newState.context.skillState!.loadedInstructions).toBeUndefined();
    });

    it('should handle return when no skillState exists', () => {
      const state = createState(undefined);
      const signal: SkillSignal = {
        type: 'RETURN_SKILL',
        result: 'Nothing to return from',
        status: 'success',
      };

      const [, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('top-level-return');
      if (result.action === 'top-level-return') {
        expect(result.skillName).toBe('');
      }
    });

    it('should handle return when skillState exists but no current', () => {
      const state = createState({
        stack: [],
        current: null,
      });
      const signal: SkillSignal = {
        type: 'RETURN_SKILL',
        result: 'No current skill',
        status: 'success',
      };

      const [, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('top-level-return');
      if (result.action === 'top-level-return') {
        expect(result.skillName).toBe('');
      }
    });

    it('should restore from deep nesting (grandparent → parent → child)', () => {
      const state = createState({
        stack: [
          {
            skillName: 'grandparent',
            loadedAt: Date.now() - 2000,
            savedInstructions: 'GP instructions',
          },
          {
            skillName: 'parent',
            loadedAt: Date.now() - 1000,
            savedInstructions: 'Parent instructions',
          },
        ],
        current: 'child',
        loadedInstructions: 'Child instructions',
      });
      const signal: SkillSignal = {
        type: 'RETURN_SKILL',
        result: 'Child done',
        status: 'success',
      };

      const [newState, result] = applySkillSignal(state, signal);

      expect(result.action).toBe('returned');
      if (result.action === 'returned') {
        expect(result.parentName).toBe('parent');
      }

      const ss = newState.context.skillState!;
      expect(ss.current).toBe('parent');
      expect(ss.loadedInstructions).toBe('Parent instructions');
      expect(ss.stack).toHaveLength(1);
      expect(ss.stack[0].skillName).toBe('grandparent');
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
  it('should format SWITCH_SKILL as friendly text', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'tell-time',
      instructions: 'Tell time',
      task: 'Get time',
    });
    expect(result).toBe("Skill 'tell-time' loaded");
  });

  it('should format RETURN_SKILL with result text', () => {
    const result = formatSkillToolResult({
      type: 'RETURN_SKILL',
      result: 'It is 3 PM',
      status: 'success',
    });
    expect(result).toBe('It is 3 PM');
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

describe('formatSkillAnswer', () => {
  it('should extract string result from RETURN_SKILL signal', () => {
    const answer = formatSkillAnswer({
      type: 'RETURN_SKILL',
      result: 'Hello, world!',
      status: 'success',
    });
    expect(answer).toBe('Hello, world!');
  });

  it('should stringify non-string result', () => {
    const answer = formatSkillAnswer({
      type: 'RETURN_SKILL',
      result: { data: 42 },
      status: 'success',
    });
    expect(answer).toBe('{"data":42}');
  });
});
