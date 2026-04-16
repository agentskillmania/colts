/**
 * @fileoverview DefaultMessageAssembler unit tests
 *
 * Tests the migrated DefaultMessageAssembler class to verify identical
 * behavior to the original buildMessages() function.
 */
import { describe, it, expect } from 'vitest';
import { DefaultMessageAssembler } from '../../src/message-assembler/default-assembler.js';
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

describe('DefaultMessageAssembler', () => {
  const assembler = new DefaultMessageAssembler();

  describe('Skill mode guides', () => {
    it('should include unified SKILL MODE guide when a skill is active', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user warmly.',
      });

      const messages = assembler.build(state, { model: 'gpt-4' });
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

      const messages = assembler.build(state, { model: 'gpt-4' });
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

      const messages = assembler.build(state, { model: 'gpt-4' });
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

      const messages = assembler.build(state, { model: 'gpt-4' });
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

      const messages = assembler.build(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      // Unified guide shows the active skill name
      expect(systemMessage?.content).toContain('SKILL MODE');
      expect(systemMessage?.content).toContain("executing the 'child' skill");
    });
  });

  describe('Prompt contract', () => {
    it('must instruct return_skill and not contain contradictory instructions', () => {
      const state = createMockState({
        stack: [],
        current: 'poet',
      });

      const messages = assembler.build(state, { model: 'gpt-4' });
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

      const messages = assembler.build(state, { model: 'gpt-4' });
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

      const messages = assembler.build(state, { model: 'gpt-4' });
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

  describe('Conversation history', () => {
    it('should include user and assistant messages in order', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
            { role: 'user', content: 'How are you?' },
          ],
          stepCount: 0,
        },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });

      // Filter out system messages, keep conversation
      const conv = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
      // First two are system instructions + ack, then 3 conversation messages
      expect(conv.length).toBeGreaterThanOrEqual(3);
      const userMsgs = conv.filter((m) => m.role === 'user' && m.content === 'Hello');
      expect(userMsgs).toHaveLength(1);
    });

    it('should handle tool result messages', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            {
              role: 'assistant',
              content: 'Let me check.',
              toolCalls: [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }],
            },
            { role: 'tool', content: 'Found results', toolCallId: 'tc-1', toolName: 'search' },
          ],
          stepCount: 0,
        },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });
      const toolResult = messages.find((m) => m.role === 'toolResult');
      expect(toolResult).toBeDefined();
      expect(toolResult?.role).toBe('toolResult');
    });

    it('should respect compression boundary', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'Old message' },
            { role: 'assistant', content: 'Old reply' },
            { role: 'user', content: 'New message' },
          ],
          stepCount: 0,
          compression: {
            summary: 'Summary of old conversation',
            anchor: 2,
          },
        },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });

      // Should contain summary but not old messages
      const hasSummary = messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('Summary of old conversation')
      );
      expect(hasSummary).toBe(true);

      const hasOld = messages.some(
        (m) => typeof m.content === 'string' && m.content === 'Old message'
      );
      expect(hasOld).toBe(false);
    });
  });

  describe('System prompt', () => {
    it('should prepend custom system prompt', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: 'Base instructions.', tools: [] },
        context: { messages: [], stepCount: 0 },
      };

      const messages = assembler.build(state, {
        model: 'gpt-4',
        systemPrompt: 'Custom system prompt.',
      });

      const first = messages[0];
      expect(first.role).toBe('user');
      expect(first.content).toContain('Custom system prompt.');
      expect(first.content).toContain('Base instructions.');
    });

    it('should work with no system prompt or instructions', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: { messages: [], stepCount: 0 },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });
      // No system parts means no system messages
      expect(messages).toHaveLength(0);
    });
  });
});
