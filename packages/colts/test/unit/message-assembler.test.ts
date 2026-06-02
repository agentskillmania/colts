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

  describe('Dynamic content extraction', () => {
    it('should NOT include skill loadedInstructions in static system prefix', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user warmly.',
      });

      const messages = assembler.build(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('[System Instructions]')
      );

      // Static prefix should NOT contain skill instructions
      expect(systemMessage?.content).not.toContain('Greet the user warmly.');
    });

    it('should NOT include SKILL MODE guide in static system prefix', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
      });

      const messages = assembler.build(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('[System Instructions]')
      );

      expect(systemMessage?.content).not.toContain('SKILL MODE');
    });

    it('should include skill instructions in system-reminder of last user message', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user warmly.',
      });
      // Add a user message so there's a "last user message" to inject into
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });

      // Find the last user message
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('<system-reminder>');
      expect(content).toContain('## Active Skill: greeting');
      expect(content).toContain('Greet the user warmly.');
      expect(content).toContain('</system-reminder>');
    });

    it('should include skill mode guide in system-reminder', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain("'greeting' skill");
      expect(content).toContain('return_skill');
    });

    it('should NOT include system-reminder when no dynamic content exists', () => {
      const state = createMockState(undefined);
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).not.toContain('<system-reminder>');
    });

    it('should inject system-reminder as new user message when last message is not user', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
      });
      (state.context as any).messages = [
        { role: 'assistant', id: '1', content: 'Hi', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const last = messages[messages.length - 1];

      // Should have added a new user message with the system-reminder
      expect(last.role).toBe('user');
      const content = typeof last.content === 'string' ? last.content : '';
      expect(content).toContain('<system-reminder>');
    });

    it('should include todolist in system-reminder when todoList is set', () => {
      const state = createMockState(undefined);
      (state.context as any).todoList = {
        items: [
          { id: 1, subject: 'Task A', status: 'pending' },
          { id: 2, subject: 'Task B', status: 'in_progress' },
        ],
      };
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('<system-reminder>');
      expect(content).toContain('## Task List');
      expect(content).toContain('[ ] 1. Task A');
      expect(content).toContain('[~] 2. Task B');
    });
  });

  describe('Skill mode guides', () => {
    it('should include skill guide in system-reminder when a skill is active', () => {
      const state = createMockState({
        stack: [],
        current: 'greeting',
        loadedInstructions: 'Greet the user warmly.',
      });
      // Need a user message for system-reminder injection target
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('<system-reminder>');
      expect(content).toContain("'greeting' skill");
      expect(content).toContain('return_skill');
      expect(content).toContain('load_skill');
    });

    it('should include skill guide for nested skill (sub-skill) in system-reminder', () => {
      const state = createMockState({
        stack: [{ skillName: 'data-analysis', loadedAt: Date.now() }],
        current: 'data-cleaning',
        loadedInstructions: '# Data Cleaning Skill\n\nClean data properly.',
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('## Active Skill: data-cleaning');
      expect(content).toContain('Data Cleaning Skill');
      expect(content).toContain("'data-cleaning' skill");
    });

    it('should not include system-reminder when no skillState', () => {
      const state = createMockState(undefined);
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).not.toContain('<system-reminder>');
    });

    it('should not include system-reminder when skillState has no current', () => {
      const state = createMockState({
        stack: [],
        current: null,
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).not.toContain('<system-reminder>');
    });

    it('should show active skill name for deeply nested skills', () => {
      const state = createMockState({
        stack: [
          { skillName: 'grandparent', loadedAt: Date.now() - 2000 },
          { skillName: 'parent', loadedAt: Date.now() - 1000 },
        ],
        current: 'child',
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain("'child' skill");
    });
  });

  describe('Prompt contract', () => {
    it('must instruct return_skill and not contain contradictory instructions', () => {
      const state = createMockState({
        stack: [],
        current: 'poet',
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('return_skill');
      expect(content).not.toContain('do NOT call return_skill');
      expect(content).toContain('load_skill');
    });
  });

  describe('Skill instructions loading', () => {
    it('should include loadedInstructions in system-reminder', () => {
      const state = createMockState({
        stack: [{ skillName: 'parent', loadedAt: Date.now() }],
        current: 'child',
        loadedInstructions: '# Child Skill\n\nDo child things.',
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('# Child Skill');
      expect(content).toContain('Do child things.');
    });

    it('should keep skill instructions out of static prefix', () => {
      const state = createMockState({
        stack: [{ skillName: 'parent', loadedAt: Date.now() }],
        current: 'child',
        loadedInstructions: '# Child Skill',
      });
      (state.context as any).messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: Date.now() },
      ];

      const messages = assembler.build(state, { model: 'gpt-4' });
      // Static prefix is messages[0]
      const systemMsg = messages.find(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('[System Instructions]')
      );

      expect(systemMsg?.content).not.toContain('# Child Skill');
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
      expect(toolResult).toEqual(expect.any(Object));
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

  describe('Thought message skipping', () => {
    it('should skip assistant thought messages from conversation history', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'Hello' },
            {
              role: 'assistant',
              type: 'thought',
              content: 'Let me think about this...',
            },
            { role: 'assistant', content: 'Hi there!' },
          ],
          stepCount: 0,
        },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });

      // No thought content should appear in the output
      const hasThought = messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('Let me think about this')
      );
      expect(hasThought).toBe(false);

      // Non-thought assistant message should still be present
      const hasReply = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c) => 'text' in c && c.text === 'Hi there!')
      );
      expect(hasReply).toBe(true);
    });

    it('should skip multiple consecutive thought messages', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'Solve this' },
            { role: 'assistant', type: 'thought', content: 'Thinking step 1...' },
            { role: 'assistant', type: 'thought', content: 'Thinking step 2...' },
            { role: 'assistant', content: 'Here is the answer.' },
          ],
          stepCount: 0,
        },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });

      const hasThought1 = messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('Thinking step 1')
      );
      const hasThought2 = messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('Thinking step 2')
      );
      expect(hasThought1).toBe(false);
      expect(hasThought2).toBe(false);
    });

    it('should preserve regular assistant messages when no thoughts exist', () => {
      const state: AgentState = {
        id: 'test',
        config: { name: 'test', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi!' },
            { role: 'user', content: 'How are you?' },
            { role: 'assistant', content: 'Fine!' },
          ],
          stepCount: 0,
        },
      };

      const messages = assembler.build(state, { model: 'gpt-4' });

      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(2);
    });
  });

  describe('enablePromptThinking', () => {
    it('should inject thinking guidance when enabled', () => {
      const state = createMockState();
      const messages = assembler.build(state, {
        model: 'gpt-4',
        enablePromptThinking: true,
      });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).toContain('think step by step');
    });

    it('should not inject thinking guidance when disabled', () => {
      const state = createMockState();
      const messages = assembler.build(state, {
        model: 'gpt-4',
        enablePromptThinking: false,
      });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).not.toContain('think step by step');
    });

    it('should not inject thinking guidance when option is absent', () => {
      const state = createMockState();
      const messages = assembler.build(state, { model: 'gpt-4' });
      const systemMessage = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string'
      );

      expect(systemMessage?.content).not.toContain('think step by step');
    });
  });
});
