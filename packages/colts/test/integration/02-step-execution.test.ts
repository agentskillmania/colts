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
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createAgentState } from '../../src/state/index.js';
import type { AgentConfig } from '../../src/types.js';
import { createExecutionState, isTerminalPhase } from '../../src/execution/index.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

describe('User Story: Step Control with Real LLM', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
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

        // And: Token usage is tracked
        expect(result.tokens).toBeDefined();
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);
        expect(newState.context.totalTokens).toBeDefined();
        expect(newState.context.totalTokens!.input).toBeGreaterThan(0);
        expect(newState.context.totalTokens!.output).toBeGreaterThan(0);

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

          // And: Token usage is tracked across steps
          expect(result2.tokens).toBeDefined();
          expect(result2.tokens.input).toBeGreaterThan(0);
          expect(result2.tokens.output).toBeGreaterThan(0);
          expect(stateAfterStep2.context.totalTokens).toBeDefined();
          expect(stateAfterStep2.context.totalTokens!.input).toBeGreaterThan(0);
          expect(stateAfterStep2.context.totalTokens!.output).toBeGreaterThan(0);
        } else {
          // LLM answered directly without tool
          expect(result1.type).toBe('done');
          if (result1.type === 'done') {
            expect(result1.answer).toBeTruthy();
          }

          // And: Token usage is tracked
          expect(result1.tokens).toBeDefined();
          expect(result1.tokens.input).toBeGreaterThan(0);
          expect(result1.tokens.output).toBeGreaterThan(0);
          expect(stateAfterStep1.context.totalTokens).toBeDefined();
          expect(stateAfterStep1.context.totalTokens!.input).toBeGreaterThan(0);
          expect(stateAfterStep1.context.totalTokens!.output).toBeGreaterThan(0);
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
        let currentExecState = createExecutionState();

        // When: Progress through phases
        const phases: string[] = [];
        let currentState = state;

        while (!isTerminalPhase(currentExecState.phase)) {
          const result = await runner.advance(currentState, currentExecState);
          currentState = result.state;
          currentExecState = result.execState;
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
        const stream = runner.stepStream(state, registry);
        let finalResult: { state: AgentState; result: StepResult } | undefined;

        while (true) {
          const { done, value } = await stream.next();
          if (done) {
            finalResult = value;
            break;
          }
          events.push({ type: value.type });
        }

        // Then: Should have phase-change events
        expect(events.some((e) => e.type === 'phase-change')).toBe(true);

        // And: Should have token events
        expect(events.some((e) => e.type === 'token')).toBe(true);

        // And: Step result should have token usage
        expect(finalResult).toBeDefined();
        expect(finalResult!.result.tokens).toBeDefined();
        expect(finalResult!.result.tokens.input).toBeGreaterThan(0);
        expect(finalResult!.result.tokens.output).toBeGreaterThan(0);
        expect(finalResult!.state.context.totalTokens).toBeDefined();
        expect(finalResult!.state.context.totalTokens!.input).toBeGreaterThan(0);
        expect(finalResult!.state.context.totalTokens!.output).toBeGreaterThan(0);
        expect(finalResult!.state.context.estimatedContextSize).toBeGreaterThan(0);
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

        // And: Token usage is accumulated
        expect(state.context.totalTokens).toBeDefined();
        expect(state.context.totalTokens!.input).toBeGreaterThan(0);
        expect(state.context.totalTokens!.output).toBeGreaterThan(0);
      },
      120000
    );
  });
});
