/**
 * @fileoverview Runner Message Builder unit tests
 *
 * Tests dynamic prompt injection and Skill mode switching.
 */
import { describe, it, expect } from 'vitest';
import { buildMessages } from '../../src/runner-message-builder.js';
import type { AgentState, SkillState } from '../../src/types.js';

function createMockState(skillState?: SkillState): AgentState {
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

describe('buildMessages', () => {
  describe('Skill mode guides', () => {
    it('should include top-level guide when availableSkills is set', () => {
      const state = createMockState({
        stack: [],
        current: null,
        availableSkills: [
          { name: 'code-review', description: 'Review code' },
          { name: 'testing', description: 'Write tests' },
        ],
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).toContain('SKILL MODE: TOP-LEVEL');
      expect(systemMessage?.content).toContain('code-review: Review code');
      expect(systemMessage?.content).toContain('testing: Write tests');
      expect(systemMessage?.content).toContain('load_skill');
    });

    it('should include sub-skill guide when in sub-skill mode', () => {
      const state = createMockState({
        stack: [{ skillName: 'data-analysis', loadedAt: Date.now() }],
        current: 'data-cleaning',
        loadedInstructions: '# Data Cleaning Skill\n\nClean data properly.',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).toContain('SKILL MODE: SUB-SKILL');
      expect(systemMessage?.content).toContain('Parent skill: data-analysis');
      expect(systemMessage?.content).toContain('Current skill: data-cleaning');
      expect(systemMessage?.content).toContain('return_skill');
      expect(systemMessage?.content).toContain('Data Cleaning Skill');
    });

    it('should not include skill guide when no skillState', () => {
      const state = createMockState(undefined);

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).not.toContain('SKILL MODE');
    });

    it('should not duplicate skill list when in sub-skill mode', () => {
      const state = createMockState({
        stack: [{ skillName: 'parent', loadedAt: Date.now() }],
        current: 'child',
        availableSkills: [{ name: 'other', description: 'Other skill' }],
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      // Should show sub-skill mode, not top-level
      expect(systemMessage?.content).toContain('SUB-SKILL');
      expect(systemMessage?.content).not.toContain('TOP-LEVEL');
      // Should not show "Available skills" from provider section
      expect(systemMessage?.content).not.toContain('Available skills:');
    });
  });

  describe('Skill instructions loading', () => {
    it('should include loadedInstructions in sub-skill mode', () => {
      const state = createMockState({
        stack: [{ skillName: 'parent', loadedAt: Date.now() }],
        current: 'child',
        loadedInstructions: '# Child Skill\n\nDo child things.',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).toContain('# Child Skill');
      expect(systemMessage?.content).toContain('Do child things.');
    });

    it('should maintain base instructions before skill instructions', () => {
      const state = createMockState({
        stack: [{ skillName: 'parent', loadedAt: Date.now() }],
        current: 'child',
        loadedInstructions: '# Child Skill',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );
      const content = systemMessage?.content as string;

      // Base instructions should come before skill instructions
      const baseIndex = content.indexOf('You are a helpful assistant.');
      const skillIndex = content.indexOf('# Child Skill');
      expect(baseIndex).toBeLessThan(skillIndex);
    });
  });

  describe('Multi-level nesting', () => {
    it('should show correct parent in deep nesting', () => {
      const state = createMockState({
        stack: [
          { skillName: 'grandparent', loadedAt: Date.now() - 2000 },
          { skillName: 'parent', loadedAt: Date.now() - 1000 },
        ],
        current: 'child',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      // Should show immediate parent (top of stack)
      expect(systemMessage?.content).toContain('Parent skill: parent');
      expect(systemMessage?.content).toContain('Current skill: child');
    });
  });
});
