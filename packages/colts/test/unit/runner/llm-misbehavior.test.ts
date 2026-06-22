/**
 * @fileoverview Naughty LLM / misbehavior tests
 *
 * Tests edge cases where the LLM does not follow expected tool-calling
 * conventions: replying directly instead of following a loaded skill,
 * cyclic (same-skill) re-loads, delegate events, etc.
 *
 * These go through the full step() / run() pipeline (not just
 * processToolResult directly) to verify end-to-end behavior.
 *
 * Note: the return_skill tool and the skill stack were removed. Skill
 * instructions now persist as the load_skill tool result content, so there
 * is no explicit return path. These tests cover the remaining misbehavior
 * scenarios (stale-skill cleanup, same-skill rejection, delegate events).
 */

import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';
import { createMockLLMClient } from '../../helpers/mock-llm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockTokens = { input: 10, output: 5 };

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

/**
 * Create a registry with a load_skill tool that produces a real SWITCH_SKILL
 * signal (bypassing the filesystem skill provider).
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
  it('should clear stale skillState when LLM replies directly after loading a skill', async () => {
    // Step 1: LLM calls load_skill → skill loaded
    // Step 2: LLM replies directly (no further skill interaction)
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
