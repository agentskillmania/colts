/**
 * @fileoverview processToolResult unit + snapshot tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, updateState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';
import { createExecutionState } from '../../src/execution.js';
import { processToolResult } from '../../src/runner-process-tool-result.js';

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
// processToolResult direct tests
// ---------------------------------------------------------------------------

describe('processToolResult', () => {
  it('should throw if phase is not tool-result', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    // phase is 'idle' by default
    await expect(processToolResult(state, execState)).rejects.toThrow(
      'processToolResult expects phase type "tool-result"'
    );
  });

  it('should return tool:end + step:continue-return for a plain tool result', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    execState.phase = { type: 'tool-result', results: { tc1: 'plain result' } };
    execState.action = { id: 'tc1', tool: 'calculator', arguments: { expr: '1+1' } };

    const outcome = await processToolResult(state, execState);

    expect(outcome.state).toBe(state);
    expect(outcome.effects.map((e) => e.type)).toEqual(['tool:end', 'step:continue-return']);
    const toolEnd = outcome.effects[0] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe('plain result');
  });

  it('should return step:done for a tool result with no tool call (completed phase)', async () => {
    // When the LLM returns a text-only response, step() reaches completed
    // phase without ever calling processToolResult.  This test verifies
    // that processToolResult is only called for tool-result phases.
    // The "no tool call" path is handled by advanceToCompleted in runner-advance.
    // So this test simply confirms processToolResult requires tool-result phase.
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    execState.phase = { type: 'completed', answer: 'done' };

    await expect(processToolResult(state, execState)).rejects.toThrow();
  });
});

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
      'phase-change', // executing-tool → tool-result
      'phase-change', // tool-result phase-change from executeAdvance
      'tool:end', // processToolResult: plain tool → tool:end effect
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

    // Streaming yields: llm:request, token*, llm:response
    // step:end is emitted via EventEmitter, not yielded
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

// ---------------------------------------------------------------------------
// processToolResult skill signal tests
// ---------------------------------------------------------------------------

describe('processToolResult - skill signals', () => {
  it('should emit skill:start + tool:end + step:continue for SWITCH_SKILL (first load)', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research',
      instructions: 'Research thoroughly',
      task: 'Find sources about X',
    };
    execState.phase = { type: 'tool-result', results: { tc1: switchSignal } };
    execState.action = {
      id: 'tc1',
      tool: 'load_skill',
      arguments: { name: 'research', task: 'Find sources about X' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual([
      'skill:start',
      'tool:end',
      'step:continue',
    ]);

    // Verify skill:start payload
    const skillStart = outcome.effects[0] as {
      type: 'skill:start';
      name: string;
      task: string;
      state: typeof state;
    };
    expect(skillStart.name).toBe('research');
    expect(skillStart.task).toBe('Find sources about X');
    expect(skillStart.state.context.skillState?.current).toBe('research');

    // Verify tool:end carries formatted string, not raw signal
    const toolEnd = outcome.effects[1] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe("Skill 'research' loaded");

    // Verify execState.phase was reset to idle
    expect(execState.phase.type).toBe('idle');
  });

  it('should emit skill:start + tool:end + step:continue for nested SWITCH_SKILL (parent pushed)', async () => {
    // Start with an active skill
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        stack: [],
        current: 'writer',
        loadedInstructions: 'Write well',
      };
    });

    const execState = createExecutionState();
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'editor',
      instructions: 'Edit carefully',
      task: 'Review the draft',
    };
    execState.phase = { type: 'tool-result', results: { tc2: switchSignal } };
    execState.action = {
      id: 'tc2',
      tool: 'load_skill',
      arguments: { name: 'editor', task: 'Review the draft' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual([
      'skill:start',
      'tool:end',
      'step:continue',
    ]);

    // Verify parent was pushed onto stack
    const skillStart = outcome.effects[0] as {
      type: 'skill:start';
      name: string;
      state: typeof state;
    };
    expect(skillStart.name).toBe('editor');
    expect(skillStart.state.context.skillState?.current).toBe('editor');
    expect(skillStart.state.context.skillState?.stack.length).toBe(1);
    expect(skillStart.state.context.skillState?.stack[0].skillName).toBe('writer');
  });

  it('should emit tool:end + step:continue-return for same-skill SWITCH_SKILL', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        stack: [],
        current: 'research',
        loadedInstructions: 'Research thoroughly',
      };
    });

    const execState = createExecutionState();
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research', // same as current
      instructions: 'Research thoroughly',
      task: 'Do it again',
    };
    execState.phase = { type: 'tool-result', results: { tc3: switchSignal } };
    execState.action = {
      id: 'tc3',
      tool: 'load_skill',
      arguments: { name: 'research', task: 'Do it again' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual(['tool:end', 'step:continue-return']);

    const toolEnd = outcome.effects[0] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe("Skill 'research' is already active");
  });

  it('should emit tool:end + step:continue-return for cyclic SWITCH_SKILL', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        stack: [{ skillName: 'research', loadedAt: Date.now(), savedInstructions: 'Research' }],
        current: 'writer',
        loadedInstructions: 'Write well',
      };
    });

    const execState = createExecutionState();
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research', // already in stack
      instructions: 'Research thoroughly',
      task: 'Cycle attempt',
    };
    execState.phase = { type: 'tool-result', results: { tc4: switchSignal } };
    execState.action = {
      id: 'tc4',
      tool: 'load_skill',
      arguments: { name: 'research', task: 'Cycle attempt' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual(['tool:end', 'step:continue-return']);

    const toolEnd = outcome.effects[0] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe("Cannot load Skill 'research': already in the call stack");
  });

  it('should emit skill:end + tool:end + step:done for top-level RETURN_SKILL', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        stack: [],
        current: 'research',
        loadedInstructions: 'Research thoroughly',
      };
    });

    const execState = createExecutionState();
    const returnSignal = {
      type: 'RETURN_SKILL',
      result: 'Found 3 relevant papers',
      status: 'success' as const,
    };
    execState.phase = { type: 'tool-result', results: { tc5: returnSignal } };
    execState.action = {
      id: 'tc5',
      tool: 'return_skill',
      arguments: { result: 'Found 3 relevant papers' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual(['skill:end', 'tool:end', 'step:done']);

    const skillEnd = outcome.effects[0] as {
      type: 'skill:end';
      name: string;
      result: string;
    };
    expect(skillEnd.name).toBe('research');
    expect(skillEnd.result).toBe('Found 3 relevant papers');

    const toolEnd = outcome.effects[1] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe('Found 3 relevant papers');

    const stepDone = outcome.effects[2] as { type: 'step:done'; answer: string };
    expect(stepDone.answer).toBe('Found 3 relevant papers');
  });

  it('should emit skill:end + tool:end + step:continue for nested RETURN_SKILL', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        stack: [
          {
            skillName: 'research',
            loadedAt: Date.now(),
            savedInstructions: 'Research thoroughly',
          },
        ],
        current: 'writer',
        loadedInstructions: 'Write well',
      };
    });

    const execState = createExecutionState();
    const returnSignal = {
      type: 'RETURN_SKILL',
      result: 'Draft completed',
      status: 'success' as const,
    };
    execState.phase = { type: 'tool-result', results: { tc6: returnSignal } };
    execState.action = {
      id: 'tc6',
      tool: 'return_skill',
      arguments: { result: 'Draft completed' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual(['skill:end', 'tool:end', 'step:continue']);

    const skillEnd = outcome.effects[0] as {
      type: 'skill:end';
      name: string;
      result: string;
    };
    // completedSkill is 'writer' (the returning sub-skill)
    expect(skillEnd.name).toBe('writer');
    expect(skillEnd.result).toBe('Draft completed');

    // Verify parent was restored
    const returnedState = outcome.state;
    expect(returnedState.context.skillState?.current).toBe('research');
    expect(returnedState.context.skillState?.stack.length).toBe(0);

    // Verify execState.phase was reset to idle
    expect(execState.phase.type).toBe('idle');
  });

  it('should emit error + step:error for SKILL_NOT_FOUND', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    const notFoundSignal = {
      type: 'SKILL_NOT_FOUND',
      requested: 'nonexistent',
      available: ['research', 'writer'],
    };
    execState.phase = { type: 'tool-result', results: { tc7: notFoundSignal } };
    execState.action = {
      id: 'tc7',
      tool: 'load_skill',
      arguments: { name: 'nonexistent' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual(['error', 'step:error']);

    const errorEffect = outcome.effects[0] as {
      type: 'error';
      error: Error;
      context: { step: number };
    };
    expect(errorEffect.error.message).toContain("Skill 'nonexistent' not found");

    const stepError = outcome.effects[1] as { type: 'step:error'; error: Error };
    expect(stepError.error).toBe(errorEffect.error);
  });
});

// ---------------------------------------------------------------------------
// processToolResult delegate tool tests
// ---------------------------------------------------------------------------

describe('processToolResult - delegate tools', () => {
  it('should emit subagent:start + tool:end + subagent:end + step:continue-return for delegate + plain result', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    execState.phase = { type: 'tool-result', results: { tc8: 'delegated task completed' } };
    execState.action = {
      id: 'tc8',
      tool: 'delegate',
      arguments: { agent: 'sub-agent', task: 'do something' },
    };

    const outcome = await processToolResult(state, execState);

    expect(outcome.effects.map((e) => e.type)).toEqual([
      'subagent:start',
      'tool:end',
      'subagent:end',
      'step:continue-return',
    ]);

    const subStart = outcome.effects[0] as {
      type: 'subagent:start';
      name: string;
      task: string;
    };
    expect(subStart.name).toBe('sub-agent');
    expect(subStart.task).toBe('do something');

    const subEnd = outcome.effects[2] as {
      type: 'subagent:end';
      name: string;
      result: unknown;
    };
    expect(subEnd.name).toBe('sub-agent');
    expect(subEnd.result).toBe('delegated task completed');
  });

  it('should emit subagent:start + skill:start + tool:end + step:continue + subagent:end for delegate + SWITCH_SKILL', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research',
      instructions: 'Research thoroughly',
      task: 'Find sources',
    };
    execState.phase = { type: 'tool-result', results: { tc9: switchSignal } };
    execState.action = {
      id: 'tc9',
      tool: 'delegate',
      arguments: { agent: 'research-agent', task: 'Find sources' },
    };

    const outcome = await processToolResult(state, execState);

    // subagent:start comes first (before skill-signal processing)
    // Then skill:start + tool:end + step:continue (from loaded action)
    // Then subagent:end (after skill-signal processing)
    expect(outcome.effects.map((e) => e.type)).toEqual([
      'subagent:start',
      'skill:start',
      'tool:end',
      'step:continue',
      'subagent:end',
    ]);

    const subStart = outcome.effects[0] as {
      type: 'subagent:start';
      name: string;
      task: string;
    };
    expect(subStart.name).toBe('research-agent');

    const skillStart = outcome.effects[1] as {
      type: 'skill:start';
      name: string;
    };
    expect(skillStart.name).toBe('research');

    const subEnd = outcome.effects[4] as {
      type: 'subagent:end';
      name: string;
      result: unknown;
    };
    expect(subEnd.name).toBe('research-agent');
  });
});

// ---------------------------------------------------------------------------
// processToolResult - multi-result (parallel tool calling) tests
// ---------------------------------------------------------------------------

describe('processToolResult - multi-result parallel tools', () => {
  it('should emit tools:end for multiple plain tool results', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    const multiResults = {
      'tc-1': 'Beijing: 25°C',
      'tc-2': 'Shanghai: 28°C',
      'tc-3': 'Guangzhou: 30°C',
    };
    execState.phase = { type: 'tool-result', results: multiResults };
    execState.action = {
      id: 'tc-1',
      tool: 'weather',
      arguments: { city: 'Beijing' },
    };

    const outcome = await processToolResult(state, execState);

    // Multiple plain results → tools:end + step:continue-return
    expect(outcome.effects.map((e) => e.type)).toEqual(['tools:end', 'step:continue-return']);

    const toolsEnd = outcome.effects[0] as {
      type: 'tools:end';
      results: Record<string, unknown>;
    };
    expect(toolsEnd.results).toEqual(multiResults);

    const stepContinue = outcome.effects[1] as {
      type: 'step:continue-return';
      toolResult: unknown;
    };
    // toolResult should be the first result for backward compat
    expect(stepContinue.toolResult).toBe('Beijing: 25°C');
  });

  it('should emit tool:end for single result even with results map', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();
    execState.phase = { type: 'tool-result', results: { 'tc-1': '42' } };
    execState.action = {
      id: 'tc-1',
      tool: 'calculator',
      arguments: { expr: '6*7' },
    };

    const outcome = await processToolResult(state, execState);

    // Single result → tool:end (not tools:end)
    expect(outcome.effects.map((e) => e.type)).toEqual(['tool:end', 'step:continue-return']);

    const toolEnd = outcome.effects[0] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe('42');
  });

  // T2: 回归测试 — delegate 不在首个 action 时仍能被检测到 (CR P0-2)
  it('should detect delegate tool when it is not the first action', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createExecutionState();

    // action 指向 calculator（非 delegate），allActions 中 delegate 在后面
    execState.phase = { type: 'tool-result', results: { 'tc-1': '42', 'tc-2': 'delegated' } };
    execState.action = {
      id: 'tc-1',
      tool: 'calculator',
      arguments: { expr: '6*7' },
    };
    execState.allActions = [
      { id: 'tc-1', tool: 'calculator', arguments: { expr: '6*7' } },
      {
        id: 'tc-2',
        tool: 'delegate',
        arguments: { agent: 'sub-expert', task: 'analyze data' },
      },
    ];

    const outcome = await processToolResult(state, execState);

    // 应检测到 delegate 并发出 subagent:start + subagent:end
    const types = outcome.effects.map((e) => e.type);
    expect(types).toContain('subagent:start');
    expect(types).toContain('subagent:end');

    const subStart = outcome.effects.find((e) => e.type === 'subagent:start') as {
      type: 'subagent:start';
      name: string;
      task: string;
    };
    expect(subStart.name).toBe('sub-expert');
    expect(subStart.task).toBe('analyze data');
  });
});
