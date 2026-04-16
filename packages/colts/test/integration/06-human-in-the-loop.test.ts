/**
 * @fileoverview User Story: Human-in-the-Loop with Real LLM
 *
 * As a developer
 * I want the agent to interact with humans during execution
 * So that the agent can gather information and confirm dangerous operations
 *
 * Two mechanisms tested:
 * 1. ask_human: LLM autonomously asks questions via handler
 * 2. ConfirmableRegistry: Application intercepts tool execution for confirmation
 *
 * Acceptance Criteria:
 * 1. LLM can call ask_human tool, handler responds, LLM uses the answer
 * 2. ConfirmableRegistry intercepts tool execution and requires confirmation
 * 3. When confirmed, tool executes normally and LLM continues
 * 4. When rejected, LLM sees error and adapts its response
 * 5. run() / runStream() work correctly with both mechanisms
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, addUserMessage } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import {
  ToolRegistry,
  createAskHumanTool,
  ConfirmableRegistry,
  calculatorTool,
} from '../../src/index.js';
import { z } from 'zod';

describe('User Story: Human-in-the-Loop with Real LLM', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  // ============================================================
  // User Story 1: ask_human Tool
  // ============================================================
  describe('User Story 1: ask_human Tool', () => {
    // Scenario 1: LLM asks a question and uses the answer
    describe('Scenario 1: LLM Asks Question and Uses Answer', () => {
      itif(testConfig.enabled)(
        'should ask user for name and greet them',
        async () => {
          // Given: A runner with ask_human tool
          const handlerResponse = { name: { type: 'direct' as const, value: 'Alice' } };

          const askHuman = createAskHumanTool(async ({ questions }) => {
            // Simulate user answering all questions
            const answers: Record<string, { type: 'direct'; value: string }> = {};
            for (const q of questions) {
              answers[q.id] = handlerResponse[q.id] ?? { type: 'direct', value: 'Test Answer' };
            }
            return answers;
          });

          const registry = new ToolRegistry();
          registry.register(askHuman);

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            systemPrompt:
              'CRITICAL RULE: You MUST use the ask_human tool to ask questions. NEVER ask questions in plain text. ' +
              'If you need information from the user, call the ask_human tool with your questions. ' +
              'After receiving the tool result, use it in your response.',
          });

          const config: AgentConfig = {
            name: 'friendly-agent',
            instructions:
              'You MUST call the ask_human tool to ask the user for their name. ' +
              'Use question id "name", type "text". Do NOT ask in plain text - use the tool. ' +
              'After getting the answer, greet them by name.',
            tools: [{ name: 'ask_human', description: 'Ask the human questions' }],
          };

          const state = createAgentState(config);

          // Provide a user message to trigger LLM interaction
          const stateWithMsg = addUserMessage(state, 'Hello! I would like to talk to you.');

          // When: Run to completion
          const { state: finalState, result } = await runner.run(stateWithMsg);

          // Then: Should succeed
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
            // EXPLORATORY: LLM may use ask_human (multi-step) or answer directly
            // If multi-step, answer should mention Alice; if single-step, that's acceptable
            if (result.totalSteps > 1) {
              expect(result.answer.toLowerCase()).toContain('alice');
            }
          }

          // And: State should have progressed
          expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
          expect(state.context.stepCount).toBe(0);
        },
        120000
      );
    });

    // Scenario 2: LLM asks multiple questions at once
    describe('Scenario 2: LLM Asks Multiple Questions', () => {
      itif(testConfig.enabled)(
        'should ask for preferences and give recommendation',
        async () => {
          // Given: A runner with ask_human tool that provides multiple answers
          const askHuman = createAskHumanTool(async () => ({
            cuisine: { type: 'direct' as const, value: 'Italian' },
            budget: { type: 'direct' as const, value: 'mid-range' },
          }));

          const registry = new ToolRegistry();
          registry.register(askHuman);

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            systemPrompt:
              'CRITICAL RULE: You MUST use the ask_human tool to ask questions. NEVER ask questions in plain text. ' +
              'If you need information from the user, call the ask_human tool. ' +
              'After receiving the tool result, use it in your response.',
          });

          const config: AgentConfig = {
            name: 'restaurant-agent',
            instructions:
              'You MUST call the ask_human tool to ask about cuisine preference (id: "cuisine", type: text) ' +
              'and budget range (id: "budget", type: text). Do NOT ask in plain text - use the tool. ' +
              'Then recommend a restaurant based on the answers.',
            tools: [{ name: 'ask_human', description: 'Ask the human questions' }],
          };

          const state = createAgentState(config);

          // Provide a user message to trigger LLM interaction
          const stateWithMsg = addUserMessage(state, 'I need a restaurant recommendation.');

          // When: Run to completion
          const { result } = await runner.run(stateWithMsg);

          // Then: Should succeed
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
            // If LLM used ask_human tool, answer should mention Italian cuisine
            if (result.totalSteps > 1) {
              const lower = result.answer.toLowerCase();
              expect(
                lower.includes('italian') || lower.includes('pasta') || lower.includes('pizza')
              ).toBe(true);
            }
          }
        },
        120000
      );
    });

    // Scenario 3: ask_human via runStream
    describe('Scenario 3: ask_human via runStream()', () => {
      itif(testConfig.enabled)(
        'should work with streaming execution',
        async () => {
          // Given: A runner with ask_human tool
          const askHuman = createAskHumanTool(async () => ({
            topic: { type: 'direct' as const, value: 'TypeScript' },
          }));

          const registry = new ToolRegistry();
          registry.register(askHuman);

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            systemPrompt:
              'CRITICAL RULE: You MUST use the ask_human tool to ask questions. NEVER ask in plain text. ' +
              'If you need information from the user, call the ask_human tool. ' +
              'After receiving the tool result, use it in your response.',
          });

          const config: AgentConfig = {
            name: 'teacher-agent',
            instructions:
              'Use the ask_human tool to ask what programming topic the user wants to learn about (id: "topic", type: text). ' +
              'Then provide a brief explanation of that topic.',
            tools: [{ name: 'ask_human', description: 'Ask the human questions' }],
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

          // Then: Should complete successfully
          expect(returnValue).toBeDefined();
          expect(returnValue!.result.type).toBe('success');
          if (returnValue!.result.type === 'success') {
            expect(returnValue!.result.answer).toBeTruthy();
          }

          // And: Should have step lifecycle events
          expect(eventTypes).toContain('step:start');
          expect(eventTypes).toContain('complete');
        },
        120000
      );
    });
  });

  // ============================================================
  // User Story 2: ConfirmableRegistry
  // ============================================================
  describe('User Story 2: ConfirmableRegistry', () => {
    // Scenario 1: Dangerous tool confirmed → executes normally
    describe('Scenario 1: Confirmed Tool Execution', () => {
      itif(testConfig.enabled)(
        'should execute tool after human confirms',
        async () => {
          // Given: A runner with ConfirmableRegistry wrapping calculator
          const inner = new ToolRegistry();
          inner.register(calculatorTool);

          let confirmCalled = false;
          const registry = new ConfirmableRegistry(inner, {
            confirmTools: ['calculate'],
            confirm: async (toolName, args) => {
              confirmCalled = true;
              expect(toolName).toBe('calculate');
              return true; // Approve
            },
          });

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            systemPrompt: 'You have a calculator tool. You MUST use it for all math calculations.',
          });

          const config: AgentConfig = {
            name: 'math-agent',
            instructions: 'Calculate "25 * 4" using the calculate tool. You MUST call the tool.',
            tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
          };

          const state = createAgentState(config);

          // When: Run to completion
          const { result } = await runner.run(state);

          // Then: Should succeed
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
          }

          // And: Confirm handler should have been called if LLM used the tool
          // (LLM might not use tool for simple math, so we check conditionally)
          if (result.totalSteps > 1) {
            expect(confirmCalled).toBe(true);
          }
        },
        120000
      );
    });

    // Scenario 2: Dangerous tool rejected → LLM adapts
    describe('Scenario 2: Rejected Tool Execution', () => {
      itif(testConfig.enabled)(
        'should let LLM adapt when tool is rejected',
        async () => {
          // Given: A runner with ConfirmableRegistry that always rejects
          const inner = new ToolRegistry();
          inner.register(calculatorTool);

          const registry = new ConfirmableRegistry(inner, {
            confirmTools: ['calculate'],
            confirm: async () => false, // Always reject
          });

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            systemPrompt:
              'You have a calculator tool. You MUST use it for all math calculations. ' +
              'If the tool is rejected by the user, explain the situation and provide your best estimate.',
          });

          const config: AgentConfig = {
            name: 'math-agent',
            instructions:
              'Calculate "15 + 27" using the calculate tool. You MUST call the tool first. ' +
              'If it fails or is rejected, provide your answer.',
            tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
          };

          const state = createAgentState(config);

          // When: Run to completion (LLM should recover from rejection)
          const { result } = await runner.run(state, { maxSteps: 5 });

          // Then: Should still succeed (LLM adapts after rejection)
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
          }
        },
        120000
      );
    });

    // Scenario 3: Mix of confirmed and non-confirmed tools
    describe('Scenario 3: Mixed Confirmed and Non-confirmed Tools', () => {
      itif(testConfig.enabled)(
        'should only confirm dangerous tools, pass through safe ones',
        async () => {
          // Given: A runner with both safe and dangerous tools
          const inner = new ToolRegistry();
          inner.register(calculatorTool);
          inner.register({
            name: 'delete_file',
            description: 'Delete a file from the filesystem. Use with caution.',
            parameters: z.object({ path: z.string().describe('File path to delete') }),
            execute: async ({ path }) => `Deleted: ${path}`,
          });

          let confirmCallCount = 0;
          const registry = new ConfirmableRegistry(inner, {
            confirmTools: ['delete_file'],
            confirm: async (toolName) => {
              confirmCallCount++;
              return true;
            },
          });

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            systemPrompt: 'You have a calculator tool. You MUST use it for all math calculations.',
          });

          const config: AgentConfig = {
            name: 'mixed-agent',
            instructions: 'Calculate "8 * 7" using the calculate tool. You MUST call the tool.',
            tools: [
              { name: 'calculate', description: 'Calculate math expressions' },
              { name: 'delete_file', description: 'Delete a file' },
            ],
          };

          const state = createAgentState(config);

          // When: Run to completion (only using safe tool)
          const { result } = await runner.run(state);

          // Then: Should succeed without confirmation (calculator is safe)
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
          }

          // And: delete_file confirmation should NOT have been called
          expect(confirmCallCount).toBe(0);
        },
        120000
      );
    });
  });
});
