/**
 * @fileoverview Runner Message Builder unit tests
 *
 * Tests dynamic prompt injection and unified Skill mode guide.
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
    it('should include unified SKILL MODE guide when a skill is active', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user warmly.',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).toContain('SKILL MODE');
      expect(systemMessage?.content).toContain("executing the 'greeting' skill");
      expect(systemMessage?.content).toContain('return_skill');
      expect(systemMessage?.content).toContain('ALWAYS use return_skill when done');
      expect(systemMessage?.content).toContain('load_skill');
    });

    it('should include unified guide for nested skill (sub-skill)', () => {
      const state = createMockState({
        stack: [{ skillName: 'data-analysis', loadedAt: Date.now() }],
        current: 'data-cleaning',
        loadedInstructions: '# Data Cleaning Skill\n\nClean data properly.',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      // Unified guide: same SKILL MODE regardless of nesting level
      expect(systemMessage?.content).toContain('SKILL MODE');
      expect(systemMessage?.content).toContain("executing the 'data-cleaning' skill");
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

    it('should not include skill guide when skillState has no current', () => {
      const state = createMockState({
        stack: [],
        current: null,
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).not.toContain('SKILL MODE');
    });

    it('should use unified guide for deeply nested skills', () => {
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

      // Unified guide shows the active skill name
      expect(systemMessage?.content).toContain('SKILL MODE');
      expect(systemMessage?.content).toContain("executing the 'child' skill");
    });
  });

  describe('Prompt contract', () => {
    it('buildSkillGuide must instruct return_skill and not contain contradictory instructions', () => {
      const state = createMockState({
        stack: [],
        current: 'poet',
      });

      const messages = buildMessages(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).toContain('return_skill');
      expect(systemMessage?.content).not.toContain('do NOT call return_skill');
      // Unified guide allows load_skill at all levels
      expect(systemMessage?.content).toContain('load_skill');
    });
  });

  describe('Skill instructions loading', () => {
    it('should include loadedInstructions in skill mode', () => {
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
});
