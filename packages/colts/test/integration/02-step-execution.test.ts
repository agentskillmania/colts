/**
 * @fileoverview User Story: Step Control with Real LLM
 *
 * As a developer
 * I want to execute ReAct steps with fine-grained control
 * So that I can debug, observe, and intervene in agent execution
 *
 * Acceptance Criteria:
 * 1. Can execute a single step (ReAct cycle) with real LLM
 * 2. Can observe step execution via streaming
 * 3. Can advance through phases one at a time
 * 4. Tool execution works end-to-end
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig, itif, logProviderInfo } from './config.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { createExecutionState, isTerminalPhase } from '../../src/execution.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

describe('User Story: Step Control with Real LLM', () => {
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
  // Scenario 1: Direct answer without tools
  describe('Scenario 1: Direct Answer (No Tools)', () => {
    itif(testConfig.enabled)(
      'should complete with done result for simple question',
      async () => {
        // Given: A runner with real LLM
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const config: AgentConfig = {
          name: 'assistant',
          instructions: 'You are a helpful assistant. Answer directly without using tools.',
          tools: [],
        };

        const state = createAgentState(config);

        // When: Execute a step
        const { state: newState, result } = await runner.step(state);

        // Then: Should complete with an answer
        expect(result.type).toBe('done');
        if (result.type === 'done') {
          expect(result.answer).toBeTruthy();
          expect(result.answer.length).toBeGreaterThan(0);
        }

        // And: State should be updated
        expect(newState.context.stepCount).toBe(1);
        expect(newState.context.messages.length).toBeGreaterThan(0);
      },
      120000
    );
  });

  // Scenario 2: Tool execution flow
  describe('Scenario 2: Tool Execution Flow', () => {
    itif(testConfig.enabled)(
      'should use calculator tool when needed',
      async () => {
        // Given: A runner with calculator tool
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You have access to a calculator tool. Use it for mathematical calculations.',
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions: 'Help with math problems. Use the calculate tool when needed.',
          tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
        };

        let state = createAgentState(config);

        // When: Ask a question requiring calculation
        const { state: stateAfterStep1, result: result1 } = await runner.step(state);

        // Then: First step should use tool (continue)
        // Note: GPT-4o-mini may or may not use the tool depending on the prompt
        // We'll check if it did use the tool
        if (result1.type === 'continue') {
          expect(result1.toolResult).toBeTruthy();

          // Second step to get final answer
          const { state: stateAfterStep2, result: result2 } = await runner.step(stateAfterStep1);

          expect(result2.type).toBe('done');
          if (result2.type === 'done') {
            expect(result2.answer).toBeTruthy();
          }
        } else {
          // LLM answered directly without tool
          expect(result1.type).toBe('done');
          if (result1.type === 'done') {
            expect(result1.answer).toBeTruthy();
          }
        }
      },
      60000
    );
  });

  // Scenario 3: Phase-by-phase advancement
  describe('Scenario 3: Phase-by-Phase Advancement', () => {
    itif(testConfig.enabled)(
      'should progress through all phases with advance()',
      async () => {
        // Given: A runner and execution state
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
        const execState = createExecutionState();

        // When: Progress through phases
        const phases: string[] = [];
        let currentState = state;

        while (!isTerminalPhase(execState.phase)) {
          const result = await runner.advance(currentState, execState);
          currentState = result.state;
          phases.push(result.phase.type);

          // Safety limit
          if (phases.length > 20) {
            break;
          }
        }

        // Then: Should complete with expected phases
        expect(phases).toContain('preparing');
        expect(phases).toContain('calling-llm');
        expect(phases).toContain('llm-response');
        expect(phases).toContain('parsing');
        expect(phases).toContain('parsed');
        expect(phases).toContain('completed');

        // And: Last phase should be completed
        expect(phases[phases.length - 1]).toBe('completed');
      },
      60000
    );
  });

  // Scenario 4: Step streaming observation
  describe('Scenario 4: Step Streaming Observation', () => {
    itif(testConfig.enabled)(
      'should emit events during stepStream',
      async () => {
        // Given: A runner with calculator tool
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'You have a calculator tool for math problems.',
        });

        const config: AgentConfig = {
          name: 'assistant',
          instructions: 'Help with math problems.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        const state = createAgentState(config);

        // When: Execute stepStream
        const events: { type: string }[] = [];
        const { result } = await runner.stepStream(state, registry).next();

        // Consume all events
        const stream = runner.stepStream(state, registry);
        for await (const event of stream) {
          events.push({ type: event.type });
        }

        // Then: Should have phase-change events
        expect(events.some((e) => e.type === 'phase-change')).toBe(true);

        // And: Should have token events
        expect(events.some((e) => e.type === 'token')).toBe(true);
      },
      60000
    );
  });

  // Scenario 5: Multi-step conversation with tool
  describe('Scenario 5: Multi-Step Conversation with Tool', () => {
    itif(testConfig.enabled)(
      'should maintain context across multiple steps',
      async () => {
        // Given: A runner with calculator tool
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions: 'You are a math assistant with a calculator tool.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        let state = createAgentState(config);
        const maxSteps = 5;
        let stepCount = 0;

        // When: Execute steps until completion or max steps
        while (stepCount < maxSteps) {
          const { state: newState, result } = await runner.step(state, registry);
          state = newState;
          stepCount++;

          if (result.type === 'done') {
            break;
          }
        }

        // Then: Should have completed within max steps
        expect(stepCount).toBeLessThan(maxSteps);
        expect(state.context.messages.length).toBeGreaterThan(0);
      },
      120000
    );
  });
});
