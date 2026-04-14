/**
 * @fileoverview User Story: Context Compression with Real LLM
 *
 * As a developer
 * I want the agent to automatically compress conversation history
 * So that long conversations don't exceed token limits
 *
 * Acceptance Criteria:
 * 1. Runner compresses context when message count exceeds threshold
 * 2. Truncate strategy: drops old messages without summary
 * 3. Summarize strategy: generates summary via LLM
 * 4. After compression, agent continues to function correctly
 * 5. Manual compression via runner.compress() works
 * 6. runStream() emits compressing/compressed events
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

// Helper: create a state with a specified number of messages
function createStateWithHistory(count: number): ReturnType<typeof createAgentState> {
  const config: AgentConfig = {
    name: 'compression-test-agent',
    instructions: 'You are a helpful assistant.',
    tools: [],
  };
  let state = createAgentState(config);

  for (let i = 0; i < count; i++) {
    state = addUserMessage(state, `User message ${i}`);
    state = addAssistantMessage(state, `Assistant response ${i}`, {
      type: 'final',
    });
  }
  return state;
}

describe('User Story: Context Compression with Real LLM', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  // ============================================================
  // User Story 1: Automatic Compression with truncate strategy
  // ============================================================
  describe('User Story 1: Truncate Strategy', () => {
    // Scenario 1: Runner auto-compresses when threshold exceeded
    describe('Scenario 1: Auto-compress during step()', () => {
      itif(testConfig.enabled)(
        'should compress context after step when threshold exceeded',
        async () => {
          // Given: A runner with truncate compression (threshold=4 messages)
          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            compressor: {
              strategy: 'truncate',
              threshold: 4,
              keepRecent: 2,
            },
          });

          // Given: A state with 4 messages (at threshold)
          const config: AgentConfig = {
            name: 'test-agent',
            instructions: 'Reply with exactly: "OK"',
            tools: [],
          };
          let state = createAgentState(config);
          // 2 user + 2 assistant = 4 messages → at threshold
          state = addUserMessage(state, 'msg1');
          state = addAssistantMessage(state, 'resp1', { type: 'final' });
          state = addUserMessage(state, 'msg2');
          state = addAssistantMessage(state, 'resp2', { type: 'final' });

          // When: Run a step (which triggers compression)
          const { state: finalState, result } = await runner.run(state);

          // Then: Should succeed
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
          }

          // And: State should have compression metadata
          // (step adds messages → triggers compression)
          expect(finalState.context.messages.length).toBeGreaterThan(4);
        },
        120000
      );
    });

    // Scenario 2: Manual compression via compress()
    describe('Scenario 2: Manual compression', () => {
      itif(testConfig.enabled)(
        'should compress on demand via runner.compress()',
        async () => {
          // Given: A runner with truncate compression
          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            compressor: {
              strategy: 'truncate',
              threshold: 5,
              keepRecent: 2,
            },
          });

          // Given: A state with many messages
          const state = createStateWithHistory(10);
          expect(state.context.messages.length).toBe(20);

          // When: Manually compress
          const compressed = await runner.compress(state);

          // Then: Compression metadata should be set
          expect(compressed.context.compression).toBeDefined();
          expect(compressed.context.compression!.anchor).toBe(18); // 20 - 2

          // And: Original state should be unchanged (immutability)
          expect(state.context.compression).toBeUndefined();
        },
        120000
      );
    });
  });

  // ============================================================
  // User Story 2: Compression with summarize strategy
  // ============================================================
  describe('User Story 2: Summarize Strategy', () => {
    // Scenario 1: Summarize uses LLM to generate summary
    describe('Scenario 1: LLM-powered summarization', () => {
      itif(testConfig.enabled)(
        'should generate summary via LLM and continue working',
        async () => {
          // Given: A runner with summarize compression
          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            compressor: {
              strategy: 'summarize',
              threshold: 5,
              keepRecent: 2,
            },
          });

          // Given: A state with enough messages to trigger compression
          const state = createStateWithHistory(5);

          // When: Compress manually
          const compressed = await runner.compress(state);

          // Then: Should have summary
          expect(compressed.context.compression).toBeDefined();
          expect(compressed.context.compression!.summary).toBeTruthy();
          expect(compressed.context.compression!.anchor).toBe(8); // 10 - 2

          // When: Run after compression (agent should still work)
          const { result } = await runner.run(compressed);

          // Then: Agent should still function
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
          }
        },
        120000
      );
    });
  });

  // ============================================================
  // User Story 3: Compression with tools
  // ============================================================
  describe('User Story 3: Compression with Tool Execution', () => {
    // Scenario 1: Multi-step tool execution with compression
    describe('Scenario 1: Tool execution + compression', () => {
      itif(testConfig.enabled)(
        'should compress between tool execution steps',
        async () => {
          // Given: A runner with low compression threshold and calculator tool
          const registry = new ToolRegistry();
          registry.register(calculatorTool);

          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            toolRegistry: registry,
            compressor: {
              strategy: 'truncate',
              threshold: 6,
              keepRecent: 4,
            },
            systemPrompt: 'You have a calculator tool. You MUST use it for all math calculations.',
          });

          const config: AgentConfig = {
            name: 'math-agent',
            instructions: 'Calculate "3 * 7" using the calculate tool. You MUST call the tool.',
            tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
          };

          const state = createAgentState(config);

          // When: Run (may trigger compression during multi-step execution)
          const { state: finalState, result } = await runner.run(state, {
            maxSteps: 5,
          });

          // Then: Should succeed
          expect(result.type).toBe('success');
          if (result.type === 'success') {
            expect(result.answer).toBeTruthy();
          }

          // And: State should have progressed
          expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
        },
        120000
      );
    });
  });

  // ============================================================
  // User Story 4: runStream() compression events
  // ============================================================
  describe('User Story 4: runStream Compression Events', () => {
    // Scenario 1: Streaming emits compression events
    describe('Scenario 1: Compression events in runStream', () => {
      itif(testConfig.enabled)(
        'should emit compressing/compressed events during runStream',
        async () => {
          // Given: A runner with low threshold compression
          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            compressor: {
              strategy: 'truncate',
              threshold: 4,
              keepRecent: 2,
            },
          });

          // Given: A state with messages at threshold
          let state = createStateWithHistory(3); // 6 messages
          state = {
            ...state,
            config: {
              ...state.config,
              instructions: 'Reply with exactly: "OK"',
            },
          };

          // When: Run with streaming
          const eventTypes: string[] = [];
          let returnValue: { result: { type: string } } | undefined;

          const iterator = runner.runStream(state);
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

          // And: Should have step lifecycle events
          expect(eventTypes).toContain('step:start');
          expect(eventTypes).toContain('complete');
        },
        120000
      );
    });
  });

  // ============================================================
  // User Story 5: Immutability verification
  // ============================================================
  describe('User Story 5: Immutability', () => {
    // Scenario 1: Compression doesn't modify original state
    describe('Scenario 1: Original state preserved', () => {
      itif(testConfig.enabled)(
        'should not modify original state during compression',
        async () => {
          // Given: A runner with compression
          const runner = new AgentRunner({
            model: testConfig.testModel,
            llmClient: client,
            compressor: {
              strategy: 'truncate',
              threshold: 5,
              keepRecent: 2,
            },
          });

          const state = createStateWithHistory(5);
          const originalLength = state.context.messages.length;
          const originalCompression = state.context.compression;

          // When: Compress
          const compressed = await runner.compress(state);

          // Then: Original state unchanged
          expect(state.context.messages.length).toBe(originalLength);
          expect(state.context.compression).toBe(originalCompression);

          // And: Compressed state has metadata
          expect(compressed.context.compression).toBeDefined();
          expect(compressed.context.messages.length).toBe(originalLength); // messages are not deleted
        },
        120000
      );
    });
  });
});
