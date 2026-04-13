/**
 * @fileoverview AgentRunner EventEmitter Tests
 *
 * Tests hierarchical event emission for reactive UI integration.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentState, LLMResponse, ILLMProvider } from '../../src/types.js';
import type { StepResult } from '../../src/execution.js';
import { createExecutionState } from '../../src/execution.js';

const defaultConfig = {
  systemPrompt: 'You are a helpful assistant.',
  maxSteps: 5,
};

const mockTokens = { input: 10, output: 5, cachedInput: 0 };

function createMockLLMClient(responses: LLMResponse[]): ILLMProvider {
  let index = 0;
  return {
    call: vi.fn(async () => {
      if (index >= responses.length) {
        return {
          content: 'Default response',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        };
      }
      return responses[index++];
    }),
    stream: vi.fn(async function* () {
      if (index >= responses.length) {
        yield { type: 'text' as const, delta: 'Default', accumulatedContent: 'Default' };
        yield { type: 'done' as const, roundTotalTokens: mockTokens };
        return;
      }
      const response = responses[index++];
      const chars = response.content.split('');
      let accumulated = '';
      for (const char of chars) {
        accumulated += char;
        yield { type: 'text' as const, delta: char, accumulatedContent: accumulated };
      }
      yield { type: 'done' as const, roundTotalTokens: response.tokens };
    }),
  };
}

describe('AgentRunner EventEmitter', () => {
  describe('flat event naming', () => {
    it('should emit run:start and run:end during run()', async () => {
      const mockResponse: LLMResponse = {
        content: 'Final answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const events: string[] = [];
      runner.on('run:start', () => events.push('run:start'));
      runner.on('run:end', () => events.push('run:end'));

      await runner.run(state);

      expect(events).toContain('run:start');
      expect(events).toContain('run:end');
    });

    it('should emit step:start and step:end during step()', async () => {
      const mockResponse: LLMResponse = {
        content: 'Step answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const events: string[] = [];
      runner.on('step:start', () => events.push('step:start'));
      runner.on('step:end', () => events.push('step:end'));

      await runner.step(state);

      expect(events).toContain('step:start');
      expect(events).toContain('step:end');
    });

    it('should emit advance:phase during step()', async () => {
      const mockResponse: LLMResponse = {
        content: 'Step answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const phases: Array<{ from: string; to: string }> = [];
      runner.on('advance:phase', (e) => {
        phases.push({ from: e.from.type, to: e.to.type });
      });

      await runner.step(state);

      expect(phases.length).toBeGreaterThan(0);
    });

    it('should emit hierarchical events during run()', async () => {
      const mockResponse: LLMResponse = {
        content: 'Final answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const events: string[] = [];
      runner.on('run:start', () => events.push('run:start'));
      runner.on('step:start', () => events.push('step:start'));
      runner.on('advance:phase', () => events.push('advance:phase'));
      runner.on('step:end', () => events.push('step:end'));
      runner.on('run:end', () => events.push('run:end'));

      await runner.run(state);

      expect(events).toContain('run:start');
      expect(events).toContain('step:start');
      expect(events).toContain('advance:phase');
      expect(events).toContain('step:end');
      expect(events).toContain('run:end');
    });

    it('should emit run:end with correct result', async () => {
      const mockResponse: LLMResponse = {
        content: 'Success answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      let endResult: { state: AgentState; result: { type: string; answer?: string } } | null = null;
      runner.on('run:end', (e) => {
        endResult = e as unknown as typeof endResult;
      });

      await runner.run(state);

      expect(endResult).not.toBeNull();
      expect(endResult!.result.type).toBe('success');
      expect(endResult!.result.answer).toBe('Success answer');
    });

    it('should emit step:end with correct result', async () => {
      const mockResponse: LLMResponse = {
        content: 'Step done',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      let endResult: { state: AgentState; stepNumber: number; result: StepResult } | null = null;
      runner.on('step:end', (e) => {
        endResult = e;
      });

      await runner.step(state);

      expect(endResult).not.toBeNull();
      expect(endResult!.result.type).toBe('done');
      expect(endResult!.stepNumber).toBe(0);
    });

    it('should emit error event on LLM exception', async () => {
      const client: ILLMProvider = {
        call: vi.fn(async () => {
          throw new Error('LLM Error');
        }),
        stream: vi.fn(async function* () {
          throw new Error('LLM Error');
        }),
      };

      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      let errorEvent: { state: AgentState; error: Error; phase: string } | null = null;
      runner.on('error', (e) => {
        errorEvent = e;
      });

      try {
        await runner.run(state);
      } catch {
        // expected
      }

      expect(errorEvent).not.toBeNull();
      expect(errorEvent!.error.message).toBe('LLM Error');
    });

    it('should support multiple concurrent listeners', async () => {
      const mockResponse: LLMResponse = {
        content: 'Test',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const events1: string[] = [];
      const events2: string[] = [];

      runner.on('run:start', () => events1.push('run:start'));
      runner.on('run:start', () => events2.push('run:start'));

      await runner.run(state);

      expect(events1).toContain('run:start');
      expect(events2).toContain('run:start');
    });

    it('should emit step events across multiple steps in run()', async () => {
      const responses: LLMResponse[] = [
        {
          content: '<tool>{"tool": "mock_tool", "arguments": {"value": "test"}}</tool>',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
        {
          content: 'Final answer',
          toolCalls: [],
          tokens: mockTokens,
          stopReason: 'stop',
        },
      ];

      const client = createMockLLMClient(responses);
      const runner = new AgentRunner({
        model: 'gpt-4',
        llmClient: client,
        tools: [
          {
            name: 'mock_tool',
            description: 'A mock tool',
            parameters: { type: 'object', properties: { value: { type: 'string' } } },
            execute: async ({ value }: { value: string }) => `Result: ${value}`,
          },
        ],
      });
      const state = createAgentState(defaultConfig);

      const stepStarts: number[] = [];
      const stepEnds: number[] = [];

      runner.on('step:start', (e) => stepStarts.push(e.stepNumber));
      runner.on('step:end', (e) => stepEnds.push(e.stepNumber));

      await runner.run(state);

      expect(stepStarts.length).toBeGreaterThanOrEqual(1);
      expect(stepEnds.length).toBeGreaterThanOrEqual(1);
    });
  });
});
