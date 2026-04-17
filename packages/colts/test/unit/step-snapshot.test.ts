/**
 * @fileoverview step() / stepStream() 集成测试
 *
 * 直接测 processToolResult 的单元测试已迁移到 tool-result-handler.test.ts。
 * 本文件保留 step()/stepStream() 路径的快照测试。
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
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

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

const mockTokens = { input: 10, output: 5 };

/**
 * Collect all non-step-control effects from a step() run.
 * Returns the effect types in order for snapshot comparison.
 */
async function collectBlockingEffects(
  runner: AgentRunner,
  state: ReturnType<typeof createAgentState>
): Promise<string[]> {
  const types: string[] = [];
  runner.on('phase-change', () => types.push('phase-change'));
  runner.on('tool:start', () => types.push('tool:start'));
  runner.on('tool:end', () => types.push('tool:end'));
  runner.on('skill:start', () => types.push('skill:start'));
  runner.on('skill:end', () => types.push('skill:end'));
  runner.on('subagent:start', () => types.push('subagent:start'));
  runner.on('subagent:end', () => types.push('subagent:end'));
  runner.on('error', () => types.push('error'));

  await runner.step(state);
  return types;
}

/**
 * Collect all non-step-control events from a stepStream() run.
 * Returns the event types in order for snapshot comparison.
 */
async function collectStreamingEffects(
  runner: AgentRunner,
  state: ReturnType<typeof createAgentState>
): Promise<string[]> {
  const types: string[] = [];
  for await (const event of runner.stepStream(state)) {
    // Skip step-level boundary events
    if (event.type === 'phase-change' || event.type === 'token') continue;
    types.push(event.type);
  }
  return types;
}

// ---------------------------------------------------------------------------
// step() snapshot tests (blocking path, basic scenarios)
// ---------------------------------------------------------------------------

describe('step() blocking path - basic scenarios', () => {
  it('should emit phase-change events for a direct answer (no tool call)', async () => {
    const client = createMockLLMClient([
      { content: 'Hello world', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const effects = await collectBlockingEffects(runner, state);

    // idle → preparing → calling-llm → llm-response → parsing → parsed → completed
    // = 6 phase-change events (each advance step emits one)
    expect(effects).toEqual([
      'phase-change',
      'phase-change',
      'phase-change',
      'phase-change',
      'phase-change',
      'phase-change',
    ]);
  });

  it('should emit tool:start + tool:end + phase-change for a plain tool call', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculator',
      description: 'Calculates math',
      parameters: z.object({ expr: z.string() }),
      execute: async () => '42',
    });

    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [
          {
            id: 'tc1',
            name: 'calculator',
            arguments: { expr: '6*7' },
          },
        ],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, tools: [] });
    const state = createAgentState(defaultConfig);

    const effects = await collectBlockingEffects(runner, state);

    // Single mock response with tool call → step() executes tool, returns continue
    expect(effects).toEqual([
      'phase-change', // idle → preparing
      'phase-change', // preparing → calling-llm
      'phase-change', // calling-llm → llm-response
      'phase-change', // llm-response → parsing
      'phase-change', // parsing → parsed
      'tool:start', // parsed → executing-tool
      'phase-change', // executing-tool → tool-result (ExecutingToolHandler)
      'phase-change', // tool-result → tool-result (ToolResultHandler 处理)
      'tool:end', // ToolResultHandler: plain tool → tool:end effect
      'phase-change', // tool-result → tool-result (ToolResultHandler phase-change emit)
    ]);
  });

  it('should return done result for a direct answer', async () => {
    const client = createMockLLMClient([
      { content: 'The answer is 42', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.step(state);
    expect(result.type).toBe('done');
    if (result.type === 'done') {
      expect(result.answer).toBe('The answer is 42');
    }
  });

  it('should return continue result for a plain tool call', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculator',
      description: 'Calculates math',
      parameters: z.object({ expr: z.string() }),
      execute: async () => '42',
    });

    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { expr: '6*7' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.step(state);
    expect(result.type).toBe('continue');
    if (result.type === 'continue') {
      expect(result.toolResult).toBe('42');
    }
  });
});

// ---------------------------------------------------------------------------
// stepStream() snapshot tests (streaming path, basic scenarios)
// ---------------------------------------------------------------------------

describe('stepStream() streaming path - basic scenarios', () => {
  it('should yield events for a direct answer', async () => {
    const client = createMockLLMClient([
      { content: 'Hello world', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const effects = await collectStreamingEffects(runner, state);

    expect(effects).toContain('llm:request');
    expect(effects).toContain('llm:response');
  });

  it('should yield tool:start + tool:end for a plain tool call', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculator',
      description: 'Calculates math',
      parameters: z.object({ expr: z.string() }),
      execute: async () => '42',
    });

    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { expr: '6*7' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const effects = await collectStreamingEffects(runner, state);

    expect(effects).toContain('tool:start');
    expect(effects).toContain('tool:end');
  });

  it('should return continue result for a plain tool call via stream', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculator',
      description: 'Calculates math',
      parameters: z.object({ expr: z.string() }),
      execute: async () => '42',
    });

    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { expr: '6*7' } }],
        tokens: mockTokens,
        stopReason: 'toolUse',
      },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const iterator = runner.stepStream(state);
    let lastValue: { state: typeof state; result: import('../../src/execution.js').StepResult };
    while (true) {
      const { done, value } = await iterator.next();
      if (done) {
        lastValue = value;
        break;
      }
    }

    expect(lastValue!.result.type).toBe('continue');
    if (lastValue!.result.type === 'continue') {
      expect(lastValue!.result.toolResult).toBe('42');
    }
  });
});
