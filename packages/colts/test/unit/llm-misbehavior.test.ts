/**
 * @fileoverview Naughty LLM / misbehavior tests
 *
 * Tests edge cases where the LLM does not follow expected tool-calling
 * conventions: ignoring return_skill, calling return_skill without an
 * active skill, triple-nested skill loads, etc.
 *
 * These go through the full step() / run() pipeline (not just
 * processToolResult directly) to verify end-to-end behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, updateState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLLMClient(responses: LLMResponse[]): LLMClient {
  let callIndex = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (callIndex >= responses.length) {
        throw new Error(`No more mock responses (index ${callIndex})`);
      }
      return Promise.resolve(responses[callIndex++]);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (callIndex >= responses.length) {
        throw new Error('No more mock responses for stream');
      }
      const response = responses[callIndex];
      const content = response.content;
      const tokens = content.split(' ');
      for (let i = 0; i < tokens.length; i++) {
        yield {
          type: 'text',
          delta: tokens[i] + (i < tokens.length - 1 ? ' ' : ''),
          accumulatedContent: tokens.slice(0, i + 1).join(' '),
        };
      }
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          yield {
            type: 'tool_call',
            toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
          };
        }
      }
      yield { type: 'done', roundTotalTokens: response.tokens };
      callIndex++;
    }),
  } as unknown as LLMClient;
}

const mockTokens = { input: 10, output: 5 };

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

/**
 * Create a registry with load_skill + return_skill tools that produce
 * real SkillSignals (bypassing the filesystem skill provider).
 */
function createSkillToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: 'load_skill',
    description: 'Load a skill',
    parameters: z.object({
      name: z.string(),
      task: z.string().optional(),
    }),
    execute: async ({ name, task }) => ({
      type: 'SWITCH_SKILL',
      to: name,
      instructions: `Instructions for ${name}`,
      task: task || 'Execute as instructed',
    }),
  });

  registry.register({
    name: 'return_skill',
    description: 'Return from a skill',
    parameters: z.object({
      result: z.string(),
      status: z.enum(['success', 'partial', 'failed']).default('success'),
    }),
    execute: async ({ result, status }) => ({
      type: 'RETURN_SKILL',
      result,
      status: status ?? 'success',
    }),
  });

  return registry;
}

/**
 * Create a registry with a mock delegate tool that returns a plain result.
 */
function createDelegateToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: 'delegate',
    description: 'Delegate a task to a sub-agent',
    parameters: z.object({
      agent: z.string(),
      task: z.string(),
    }),
    execute: async () => ({
      answer: 'Sub-agent completed the task',
      totalSteps: 1,
      finalState: null,
    }),
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Naughty LLM tests
// ---------------------------------------------------------------------------

describe('Naughty LLM - misbehavior edge cases', () => {
  it('should clear stale skillState when LLM ignores return_skill and replies directly', async () => {
    // Step 1: LLM calls load_skill → skill loaded
    // Step 2: LLM replies directly instead of calling return_skill
    const registry = createSkillToolRegistry();
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'load_skill', arguments: { name: 'poet', task: 'Write a poem' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      {
        content: 'Here is a haiku: code compiles fast',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state);

    // run() should succeed (done from direct answer in step 2)
    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('Here is a haiku: code compiles fast');
    }

    // cleanupStaleSkillState should have cleared the active skill
    expect(finalState.context.skillState?.current).toBeNull();
  });

  it('should emit skill:end with correct sub-skill name via runStream', async () => {
    const registry = createSkillToolRegistry();
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'load_skill', arguments: { name: 'child', task: 'Do child work' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc2', name: 'return_skill', arguments: { result: 'Child work done' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      { content: 'All done', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runner.runStream(state)) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    // Find the skill:end event — it should carry the correct name
    const skillEnd = events.find((e) => e.type === 'skill:end');
    expect(skillEnd).toBeDefined();
    expect((skillEnd as { type: string; name: string }).name).toBe('child');
  });

  it('should recover when return_skill is called without an active skill', async () => {
    // return_skill called with no active skill → top-level-return，不直接结束
    // 需要第二轮 LLM 输出来完成任务
    const registry = createSkillToolRegistry();
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'return_skill', arguments: { result: 'Nothing to return from' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      { content: 'Nothing to return from', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    // top-level-return 后 LLM 继续输出文本，run 完成
    expect(result.type).toBe('success');
  });

  it('should emit subagent:start and subagent:end for delegate tool via blocking run', async () => {
    const registry = createDelegateToolRegistry();
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { agent: 'helper', task: 'Assist user' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      { content: 'Delegation complete', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const events: string[] = [];
    runner.on('subagent:start', () => events.push('subagent:start'));
    runner.on('subagent:end', () => events.push('subagent:end'));

    await runner.run(state);

    expect(events).toContain('subagent:start');
    expect(events).toContain('subagent:end');
  });

  it('should handle triple-nested skill loading and returning', async () => {
    // Three skill loads (outer → middle → inner), then three returns (inner → middle → outer)
    const registry = createSkillToolRegistry();
    const client = createMockLLMClient([
      // Step 1: load outer
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'load_skill', arguments: { name: 'outer', task: 'Start outer' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Step 2: load middle (nested under outer)
      {
        content: '',
        toolCalls: [
          { id: 'tc2', name: 'load_skill', arguments: { name: 'middle', task: 'Start middle' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Step 3: load inner (nested under middle)
      {
        content: '',
        toolCalls: [
          { id: 'tc3', name: 'load_skill', arguments: { name: 'inner', task: 'Start inner' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Step 4: return from inner
      {
        content: '',
        toolCalls: [{ id: 'tc4', name: 'return_skill', arguments: { result: 'Inner done' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Step 5: return from middle
      {
        content: '',
        toolCalls: [{ id: 'tc5', name: 'return_skill', arguments: { result: 'Middle done' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Step 6: return from outer (top-level return，不直接结束)
      {
        content: '',
        toolCalls: [{ id: 'tc6', name: 'return_skill', arguments: { result: 'Outer done' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Step 7: LLM 输出最终文本
      { content: 'All skills completed', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    // Collect all lifecycle events
    const skillEvents: Array<{ type: string; name: string }> = [];
    runner.on('skill:start', (evt: unknown) => {
      const e = evt as { name: string };
      skillEvents.push({ type: 'skill:start', name: e.name });
    });
    runner.on('skill:end', (evt: unknown) => {
      const e = evt as { name: string };
      skillEvents.push({ type: 'skill:end', name: e.name });
    });

    const { result, state: finalState } = await runner.run(state);

    // Verify all 3 skills loaded in order
    const starts = skillEvents.filter((e) => e.type === 'skill:start');
    expect(starts.map((e) => e.name)).toEqual(['outer', 'middle', 'inner']);

    // Verify returns in correct order (inner first, then middle, then outer)
    const ends = skillEvents.filter((e) => e.type === 'skill:end');
    expect(ends.map((e) => e.name)).toEqual(['inner', 'middle', 'outer']);

    // 最终 run 完成
    expect(result.type).toBe('success');

    // Stack should be empty after all returns
    expect(finalState.context.skillState?.current).toBeNull();
  });

  it('should reject cyclic skill loading during a run', async () => {
    // Load outer, then try to load outer again (cyclic)
    const registry = createSkillToolRegistry();
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'load_skill', arguments: { name: 'outer', task: 'Start outer' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Try to load 'outer' again — should be rejected as cyclic (in stack via self)
      {
        content: '',
        toolCalls: [
          { id: 'tc2', name: 'load_skill', arguments: { name: 'outer', task: 'Load again' } },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
      // Continue normally
      { content: 'Moving on', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const toolEnds: unknown[] = [];
    runner.on('tool:end', (evt: unknown) => toolEnds.push(evt));

    const { result } = await runner.run(state);

    // Should have loaded 'outer' once, then rejected the cyclic load
    expect(result.type).toBe('success');
    // The second tool:end should contain the cyclic rejection message
    const cyclicToolEnd = toolEnds[1] as { result: string };
    expect(cyclicToolEnd.result).toContain('already active');
  });

  it('should handle empty toolCalls array in LLM response', async () => {
    // LLM returns a response with content and empty toolCalls array
    const client = createMockLLMClient([
      { content: 'Direct answer', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('Direct answer');
    }
  });
});
