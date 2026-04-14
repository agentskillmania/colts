/**
 * @fileoverview User Story: Error Handling with Real LLM
 *
 * As a developer
 * I want tool errors to be passed to the LLM for self-recovery
 * So that the agent can handle tool failures gracefully without crashing
 *
 * Acceptance Criteria:
 * 1. Tool error is captured as string and returned as tool result
 * 2. LLM receives the error message and can recover in the next step
 * 3. run() completes successfully even when tool errors occur
 * 4. runStream() emits tool:start/tool:end events and completes successfully
 * 5. Original state remains unchanged after error recovery
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry } from '../../src/index.js';
import { z } from 'zod';

describe('User Story: Error Handling with Real LLM', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  // Scenario 1: Failing tool → LLM sees error → recovers with direct answer
  describe('Scenario 1: Tool Error Recovery via run()', () => {
    itif(testConfig.enabled)(
      'should let LLM recover from tool error and give final answer',
      async () => {
        // Given: A runner with a calculator that always fails
        const registry = new ToolRegistry();
        registry.register({
          name: 'calculate',
          description:
            'Calculate the result of a mathematical expression. You MUST use this tool for any math calculation.',
          parameters: z.object({
            expression: z.string().describe('Math expression to evaluate'),
          }),
          execute: async () => {
            throw new Error('Calculation service unavailable: connection timeout');
          },
        });

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You MUST use the calculate tool for ALL math questions, even if you think you know the answer. After receiving the tool result (including errors), provide your final answer.',
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions:
            'You are a math assistant. You MUST call the calculate tool for the expression "25 * 4 + 13". After getting the result, provide the answer.',
          tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
        };

        const state = createAgentState(config);

        // When: Run to completion
        const { state: finalState, result } = await runner.run(state);

        // Then: Should succeed (LLM recovers from tool error)
        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
          // LLM should call the tool at least once, then recover
          expect(result.totalSteps).toBeGreaterThanOrEqual(1);
        }

        // And: Original state unchanged
        expect(state.context.stepCount).toBe(0);
        expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
      },
      120000
    );
  });

  // Scenario 2: step() returns continue with error string, then LLM recovers
  describe('Scenario 2: Step-by-step Tool Error Observation', () => {
    itif(testConfig.enabled)(
      'should return continue with error message, then LLM recovers',
      async () => {
        // Given: A runner with a failing calculator
        const registry = new ToolRegistry();
        registry.register({
          name: 'calculate',
          description:
            'Calculate the result of a mathematical expression. You MUST use this tool for any math.',
          parameters: z.object({
            expression: z.string().describe('Math expression'),
          }),
          execute: async () => {
            throw new Error('Calculation engine crashed');
          },
        });

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You MUST use the calculate tool for ALL math. If it fails, explain the error and give your best estimate.',
        });

        const config: AgentConfig = {
          name: 'math-assistant',
          instructions:
            'Calculate "15 * 3" using the calculate tool. If the tool fails, provide your answer anyway.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        const state = createAgentState(config);

        // When: Execute first step
        const { state: state1, result: result1 } = await runner.step(state, registry);

        // Then: Should return continue with error
        // (LLM may call tool → error, or may answer directly)
        if (result1.type === 'continue') {
          // Tool was called and returned error string
          expect(String(result1.toolResult)).toContain('Error');
          expect(state1.context.stepCount).toBe(1);

          // Step 2: LLM should recover
          const { result: result2 } = await runner.step(state1, registry);
          expect(result2.type).toBe('done');
        }
        // If LLM answered directly without tool, that's also acceptable

        // And: Original state unchanged
        expect(state.context.stepCount).toBe(0);
      },
      60000
    );
  });

  // Scenario 3: runStream with tool error → LLM recovers
  describe('Scenario 3: Tool Error Recovery via runStream()', () => {
    itif(testConfig.enabled)(
      'should recover from tool error in streaming mode',
      async () => {
        // Given: A runner with a failing calculator
        const registry = new ToolRegistry();
        registry.register({
          name: 'calculate',
          description:
            'Calculate the result of a mathematical expression. You MUST use this tool for any math.',
          parameters: z.object({
            expression: z.string().describe('Math expression'),
          }),
          execute: async () => {
            throw new Error('Math engine overload');
          },
        });

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You MUST use the calculate tool for ALL math. If it fails, apologize and give your best estimate.',
        });

        const config: AgentConfig = {
          name: 'stream-agent',
          instructions:
            'Calculate "100 / 7" using the calculate tool. If it fails, give your estimate.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        const state = createAgentState(config);

        // When: Run with streaming
        const eventTypes: string[] = [];
        let returnValue: { result: { type: string } } | undefined;

        const iterator = runner.runStream(state, undefined, registry);
        while (true) {
          const { done, value } = await iterator.next();
          if (done) {
            returnValue = value;
            break;
          }
          eventTypes.push(value.type);
        }

        // Then: Should complete with success
        expect(returnValue).toBeDefined();
        expect(returnValue!.result.type).toBe('success');
        if (returnValue!.result.type === 'success') {
          expect(returnValue!.result.answer).toBeTruthy();
        }

        // And: Should have step lifecycle events
        expect(eventTypes).toContain('step:start');
        expect(eventTypes).toContain('step:end');
        expect(eventTypes).toContain('complete');

        // If LLM called the tool, should have tool events
        if (eventTypes.includes('tool:start')) {
          expect(eventTypes).toContain('tool:end');
        }
      },
      120000
    );
  });

  // Scenario 4: Flaky tool (fail first, succeed second)
  describe('Scenario 4: Intermittent Tool Failure', () => {
    itif(testConfig.enabled)(
      'should handle tool that fails on first call and succeeds on second',
      async () => {
        // Given: A flaky calculator that fails once then succeeds
        let callCount = 0;
        const registry = new ToolRegistry();
        registry.register({
          name: 'calculate',
          description:
            'Calculate the result of a mathematical expression. You MUST use this tool for any math.',
          parameters: z.object({
            expression: z.string().describe('Math expression'),
          }),
          execute: async ({ expression }) => {
            callCount++;
            if (callCount === 1) {
              throw new Error('Temporary failure: rate limited');
            }
            // Simple evaluation for the test
            const result = Function(`return (${expression})`)();
            return String(result);
          },
        });

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You MUST use the calculate tool for ALL math. If the tool fails, try calling it again with the same expression.',
        });

        const config: AgentConfig = {
          name: 'retry-agent',
          instructions: 'Calculate "42 * 2" using the calculate tool. You MUST call the tool.',
          tools: [{ name: 'calculate', description: 'Calculate' }],
        };

        const state = createAgentState(config);

        // When: Run to completion
        const { result } = await runner.run(state);

        // Then: Should succeed eventually
        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
        }
      },
      120000
    );
  });
});
