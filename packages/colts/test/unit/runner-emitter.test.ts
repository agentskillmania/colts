/**
 * @fileoverview AgentRunner EventEmitter tests
 *
 * Verify alignment between EventEmitter events and AsyncGenerator yield events:
 * names and payload structures are fully consistent.
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
  describe('Lifecycle events', () => {
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

    it('should emit phase-change events during step()', async () => {
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
      runner.on('phase-change', (e) => {
        phases.push({ from: e.from.type, to: e.to.type });
      });

      await runner.step(state);

      expect(phases.length).toBeGreaterThan(0);
    });

    it('should emit hierarchical events during run() (aligned with yield)', async () => {
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
      runner.on('phase-change', () => events.push('phase-change'));
      runner.on('step:end', () => events.push('step:end'));
      runner.on('run:end', () => events.push('run:end'));

      await runner.run(state);

      expect(events).toContain('run:start');
      expect(events).toContain('step:start');
      expect(events).toContain('phase-change');
      expect(events).toContain('step:end');
      expect(events).toContain('run:end');
    });
  });

  describe('Payload alignment', () => {
    it('run:end payload should contain state and result', async () => {
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

    it('step:end payload should contain step and result (aligned with RunStreamEvent)', async () => {
      const mockResponse: LLMResponse = {
        content: 'Step done',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      let endResult: { step: number; result: StepResult } | null = null;
      runner.on('step:end', (e) => {
        endResult = e;
      });

      await runner.step(state);

      expect(endResult).not.toBeNull();
      expect(endResult!.result.type).toBe('done');
      expect(endResult!.step).toBe(0);
    });

    it('step:start payload should contain step and state (aligned with RunStreamEvent)', async () => {
      const mockResponse: LLMResponse = {
        content: 'Step answer',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      let startPayload: { step: number; state: AgentState } | null = null;
      runner.on('step:start', (e) => {
        startPayload = e;
      });

      await runner.step(state);

      expect(startPayload).not.toBeNull();
      expect(startPayload!.step).toBe(0);
      expect(startPayload!.state).toBeDefined();
    });

    it('phase-change payload should contain from and to (no state, aligned with StreamEvent)', async () => {
      const mockResponse: LLMResponse = {
        content: 'Test',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      };

      const client = createMockLLMClient([mockResponse]);
      const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
      const state = createAgentState(defaultConfig);

      const payloads: Array<{ from: unknown; to: unknown }> = [];
      runner.on('phase-change', (e) => {
        payloads.push(e);
      });

      await runner.step(state);

      expect(payloads.length).toBeGreaterThan(0);
      // payload contains only from and to, not state
      for (const p of payloads) {
        expect(p).toHaveProperty('from');
        expect(p).toHaveProperty('to');
        expect(Object.keys(p)).toEqual(['from', 'to', 'timestamp']);
      }
    });

    it('error payload should contain error and context (aligned with StreamEvent)', async () => {
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

      let errorEvent: { error: Error; context: { toolName?: string; step: number } } | null = null;
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
      expect(errorEvent!.context).toHaveProperty('step');
    });
  });

  describe('Multiple listeners and multiple steps', () => {
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

      runner.on('step:start', (e) => stepStarts.push(e.step));
      runner.on('step:end', (e) => stepEnds.push(e.step));

      await runner.run(state);

      expect(stepStarts.length).toBeGreaterThanOrEqual(1);
      expect(stepEnds.length).toBeGreaterThanOrEqual(1);
    });
  });
});
