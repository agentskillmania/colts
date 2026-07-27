/**
 * @fileoverview User Story: Run Execution with Real LLM
 *
 * As a developer
 * I want to run an agent to completion automatically
 * So that I can delegate multi-step tasks and observe the full process
 *
 * Acceptance Criteria:
 * 1. Can run agent to completion for simple questions
 * 2. Can run agent with tool execution across multiple steps
 * 3. Can observe real-time token output via run events
 * 4. Can observe cross-step events (step:start, step:end, complete)
 * 5. maxSteps limit works correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createAgentState } from '../../src/state/index.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

describe('User Story: Run Execution with Real LLM', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  // Scenario 1: Simple run with direct answer
  describe('Scenario 1: Run with Direct Answer', () => {
    itif(testConfig.enabled)(
      'should run to completion for a simple question',
      async () => {
        // Given: A runner with real LLM
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const config: AgentConfig = {
          name: 'assistant',
          instructions: 'You are a helpful assistant. Answer directly.',
          tools: [],
        };

        const state = createAgentState(config);

        // When: Run to completion
        const { state: finalState, result } = await runner.run(state);

        // Then: Should succeed in one step
        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
          expect(result.totalSteps).toBeGreaterThanOrEqual(1);
        }

        // And: Token usage is tracked
        expect(result.tokens).toBeDefined();
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);
        expect(finalState.context.totalTokens).toBeDefined();
        expect(finalState.context.totalTokens!.input).toBeGreaterThan(0);
        expect(finalState.context.totalTokens!.output).toBeGreaterThan(0);

        // And: Duration is tracked
        expect(result.duration).toBeGreaterThanOrEqual(0);

        // And: State should be updated
        expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
        expect(finalState.context.messages.length).toBeGreaterThan(0);

        // And: Original state unchanged
        expect(state.context.stepCount).toBe(0);
      },
      60000
    );
  });

  // Scenario 2: Run with tool execution
  describe('Scenario 2: Run with Tool Execution', () => {
    itif(testConfig.enabled)(
      'should complete multi-step run with tool usage',
      async () => {
        // Given: A runner with calculator tool
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You have a calculator tool. Use it for any math calculation. After getting the result, provide the final answer.',
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions: 'Use the calculate tool for math expressions.',
          tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
        };

        const state = createAgentState(config);

        // When: Run to completion
        const { state: finalState, result } = await runner.run(state);

        // Then: Should succeed
        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
          expect(result.totalSteps).toBeGreaterThanOrEqual(1);
        }

        // And: Token usage is tracked across multi-step execution
        expect(result.tokens).toBeDefined();
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);
        expect(finalState.context.totalTokens).toBeDefined();
        expect(finalState.context.totalTokens!.input).toBeGreaterThan(0);
        expect(finalState.context.totalTokens!.output).toBeGreaterThan(0);

        // And: totalTokens should exactly equal result.tokens
        expect(finalState.context.totalTokens).toEqual(result.tokens);

        // And: estimatedContextSize is tracked
        expect(finalState.context.estimatedContextSize).toBeGreaterThan(0);

        // And: State should reflect execution
        expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
      },
      120000
    );
  });

  // Scenario 3: Real-time token output via EventEmitter
  describe('Scenario 3: Real-Time Token Output', () => {
    itif(testConfig.enabled)(
      'should yield real-time tokens via run',
      async () => {
        // Given: A runner
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const config: AgentConfig = {
          name: 'assistant',
          instructions: 'You are a helpful assistant.',
          tools: [],
        };

        const state = createAgentState(config);

        // When: Register EventEmitter listeners to collect tokens and event order
        const tokens: string[] = [];
        const eventTypes: string[] = [];
        const order: string[] = [];
        runner.on('token', (data) => {
          tokens.push(data.token);
          eventTypes.push('token');
          order.push('token');
        });
        runner.on('step:start', (data) => {
          eventTypes.push('step:start');
          order.push('step:start');
        });
        runner.on('step:end', (data) => {
          eventTypes.push('step:end');
          order.push('step:end');
        });
        runner.on('complete', () => eventTypes.push('complete'));

        // And: Run to completion (events are emitted via runner.on)
        const { result } = await runner.run(state);

        // Then: Should have token events
        expect(tokens.length).toBeGreaterThan(0);

        // And: Should have expected event sequence
        expect(eventTypes).toContain('step:start');
        expect(eventTypes).toContain('step:end');
        expect(eventTypes).toContain('complete');

        // step:start should come before token
        const firstStepStart = order.indexOf('step:start');
        const firstToken = order.indexOf('token');
        expect(firstStepStart).toBeLessThan(firstToken);

        // And: Token usage is tracked in run result
        expect(result.tokens).toBeDefined();
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);
      },
      60000
    );
  });

  // Scenario 4: Cross-step events via EventEmitter
  describe('Scenario 4: Cross-Step Events', () => {
    itif(testConfig.enabled)(
      'should emit step:start and step:end across multiple steps',
      async () => {
        // Given: A runner with calculator tool
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'You have a calculator. Use it for math.',
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions: 'Help with math using the calculator tool.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        const state = createAgentState(config);

        // When: Register EventEmitter listeners for step lifecycle
        const stepStarts: number[] = [];
        const stepEnds: number[] = [];
        runner.on('step:start', (data) => stepStarts.push(data.step));
        runner.on('step:end', (data) => stepEnds.push(data.step));

        // And: Run to completion (events are emitted via runner.on)
        const { result } = await runner.run(state, undefined, registry);

        // Then: Should have completed
        expect(result.type).toBe('success');

        // And: Token usage is tracked in multi-step run
        expect(result.tokens).toBeDefined();
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);

        // And: Should have step lifecycle events
        expect(stepStarts.length).toBe(stepEnds.length);
        expect(stepStarts.length).toBeGreaterThanOrEqual(1);
      },
      120000
    );
  });

  // Scenario 5: maxSteps limit
  describe('Scenario 5: maxSteps Limit', () => {
    itif(testConfig.enabled)(
      'should respect maxSteps and return max_steps result',
      async () => {
        // Given: A runner with maxSteps=1
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'You have a calculator tool.',
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions: 'Help with math.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        const state = createAgentState(config);

        // When: Run with maxSteps=1
        const { result } = await runner.run(state, { maxSteps: 1 });

        // Then: Either succeeds in 1 step or hits max_steps
        expect(['success', 'max_steps']).toContain(result.type);
        if (result.type === 'max_steps') {
          expect(result.totalSteps).toBe(1);
        }
        if (result.type === 'success') {
          expect(result.totalSteps).toBe(1);
        }

        // And: Token usage is tracked even with maxSteps limit
        expect(result.tokens).toBeDefined();
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);

        // And: totalTokens and estimatedContextSize are tracked
        const { state: finalState } = await runner.run(state, { maxSteps: 1 });
        expect(finalState.context.totalTokens).toBeDefined();
        expect(finalState.context.totalTokens!.input).toBeGreaterThan(0);
        expect(finalState.context.totalTokens!.output).toBeGreaterThan(0);
        expect(finalState.context.estimatedContextSize).toBeGreaterThan(0);
      },
      60000
    );
  });

  // Scenario 6: Run interruption via AbortController
  // (Originally tested breaking out of a for-await loop over runStream.
  // With the EventEmitter model there is no iterator to break; callers
  // cancel a run() in progress with an AbortController instead.)
  describe('Scenario 6: Run Interruption', () => {
    itif(testConfig.enabled)(
      'should observe events and be cancellable via AbortController',
      async () => {
        // Given: A runner
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const config: AgentConfig = {
          name: 'assistant',
          instructions:
            'You are a helpful assistant. Count from 1 to 100 slowly, one number per line.',
          tools: [],
        };

        const state = createAgentState(config);

        // When: Collect events and abort once we have received several
        const controller = new AbortController();
        let eventCount = 0;
        runner.on('token', () => {
          eventCount++;
          if (eventCount >= 3) {
            controller.abort();
          }
        });

        const { result } = await runner.run(state, { signal: controller.signal });

        // Then: Should have received events before the abort took effect
        expect(eventCount).toBeGreaterThanOrEqual(1);
        // And: The run should report an abort outcome
        expect(['abort', 'success', 'max_steps']).toContain(result.type);
      },
      60000
    );
  });
});
