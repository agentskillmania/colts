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
 * 3. Can observe real-time token output via runStream
 * 4. Can observe cross-step events (step:start, step:end, complete)
 * 5. maxSteps limit works correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig, itif, logProviderInfo } from './config.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

describe('User Story: Run Execution with Real LLM', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();

    if (testConfig.enabled) {
      client = new LLMClient({
        baseUrl: testConfig.baseUrl,
      });

      client.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 5,
      });

      client.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 3,
        models: [
          {
            modelId: testConfig.testModel,
            maxConcurrency: 2,
          },
        ],
      });
    }
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

        // And: State should reflect execution
        expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
      },
      120000
    );
  });

  // Scenario 3: RunStream with real-time tokens
  describe('Scenario 3: RunStream Real-Time Output', () => {
    itif(testConfig.enabled)(
      'should yield real-time tokens via runStream',
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

        // When: Run with streaming
        const tokens: string[] = [];
        const eventTypes: string[] = [];

        for await (const event of runner.runStream(state)) {
          eventTypes.push(event.type);
          if (event.type === 'token') {
            tokens.push(event.token);
          }
        }

        // Then: Should have token events
        expect(tokens.length).toBeGreaterThan(0);

        // And: Should have expected event sequence
        expect(eventTypes).toContain('step:start');
        expect(eventTypes).toContain('step:end');
        expect(eventTypes).toContain('complete');

        // step:start should come before token
        const firstStepStart = eventTypes.indexOf('step:start');
        const firstToken = eventTypes.indexOf('token');
        expect(firstStepStart).toBeLessThan(firstToken);
      },
      60000
    );
  });

  // Scenario 4: RunStream cross-step events
  describe('Scenario 4: RunStream Cross-Step Events', () => {
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

        // When: Run with streaming
        const stepStarts: number[] = [];
        const stepEnds: number[] = [];
        let completeResult: unknown;

        const iterator = runner.runStream(state, undefined, registry);
        while (true) {
          const { done, value } = await iterator.next();
          if (done) {
            completeResult = value.result;
            break;
          }
          if (value.type === 'step:start') stepStarts.push(value.step);
          if (value.type === 'step:end') stepEnds.push(value.step);
        }

        // Then: Should have completed
        expect(completeResult).toBeDefined();
        if (completeResult && typeof completeResult === 'object' && 'type' in completeResult) {
          expect(completeResult.type).toBe('success');
        }

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
      },
      60000
    );
  });

  // Scenario 6: RunStream interruption
  describe('Scenario 6: RunStream Interruption', () => {
    itif(testConfig.enabled)(
      'should support breaking out of runStream',
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

        // When: Break out after receiving some events
        let eventCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const event of runner.runStream(state)) {
          eventCount++;
          if (eventCount >= 3) break;
        }

        // Then: Should have received events before break
        expect(eventCount).toBe(3);
      },
      60000
    );
  });
});
