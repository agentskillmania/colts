/**
 * Thinking Mechanism Integration Tests
 *
 * Validates explicit thinking extraction and message separation
 * using a real LLM API (glm-5 which supports native thinking).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { LLMClient } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { z } from 'zod';

describe('User Story: Thinking Mechanism with Real LLM', () => {
  let client: LLMClient;
  let registry: ToolRegistry;

  beforeAll(() => {
    // Use glm-5 for thinking tests because it supports native thinking.
    // Other integration tests use glm-4 via testConfig.
    client = new LLMClient({
      baseUrl: testConfig.baseUrl,
    });

    if (testConfig.enabled) {
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
            modelId: 'glm-5',
            maxConcurrency: 2,
          },
        ],
      });
    }

    registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echo the input back',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => text,
    });
  });

  itif(testConfig.enabled)(
    'should save native thinking as separate thought message for final answer',
    async () => {
      const runner = new AgentRunner({
        model: 'glm-5',
        llmClient: client,
      });

      const state = createAgentState({
        name: 'think-test',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });

      const { state: finalState } = await runner.run(state, 'What is 15 + 27?');
      const messages = finalState.context.messages;

      // glm-5 returns native thinking. Verify it is saved as a thought message.
      const thoughtMsgs = messages.filter((m) => m.type === 'thought');
      const textMsgs = messages.filter((m) => m.type === 'text');

      expect(thoughtMsgs.length).toBeGreaterThanOrEqual(1);
      expect(thoughtMsgs[0].content.length).toBeGreaterThan(0);

      // Text message may be empty if the model only returns thinking.
      // If text exists, it should be non-empty.
      if (textMsgs.length > 0) {
        expect(textMsgs[0].content.length).toBeGreaterThan(0);
      }

      // Thought and text should be different messages
      if (textMsgs.length > 0 && textMsgs[0].content.length > 0) {
        expect(thoughtMsgs[0].content).not.toBe(textMsgs[0].content);
      }
    },
    30000
  );

  itif(testConfig.enabled)(
    'should save native thinking with action message for tool call',
    async () => {
      const runner = new AgentRunner({
        model: 'glm-5',
        llmClient: client,
      });

      const state = createAgentState({
        name: 'think-tool-test',
        instructions: 'You have an echo tool. When asked to echo something, use the echo tool.',
        tools: registry.toToolSchemas(),
      });

      const { state: finalState } = await runner.run(state, 'Echo "integration test"', registry);
      const messages = finalState.context.messages;

      // Should have a thought message from native thinking
      const thoughtMsgs = messages.filter((m) => m.type === 'thought');
      expect(thoughtMsgs.length).toBeGreaterThanOrEqual(1);
      expect(thoughtMsgs[0].content.length).toBeGreaterThan(0);

      // Action message should exist if tool was called
      const actionMsgs = messages.filter((m) => m.type === 'action');
      if (actionMsgs.length > 0) {
        expect(actionMsgs[0].toolCalls).toBeDefined();
        expect(actionMsgs[0].toolCalls!.length).toBeGreaterThan(0);
      }

      // Tool result message should exist if tool was called
      const toolResultMsgs = messages.filter((m) => m.type === 'tool-result');
      if (toolResultMsgs.length > 0) {
        expect(toolResultMsgs[0].content.length).toBeGreaterThan(0);
      }
    },
    30000
  );

  itif(testConfig.enabled)(
    'should preserve thinking in stream mode via stepStream',
    async () => {
      const runner = new AgentRunner({
        model: 'glm-5',
        llmClient: client,
      });

      const state = createAgentState({
        name: 'stream-think-test',
        instructions: 'You are a helpful assistant.',
        tools: [],
      });

      // Consume stepStream to get final state
      const iterator = runner.stepStream(state);
      let result = await iterator.next();
      while (!result.done) {
        result = await iterator.next();
      }

      const finalState = result.value.state;
      const messages = finalState.context.messages;

      // Should have a thought message from native thinking
      const thoughtMsgs = messages.filter((m) => m.type === 'thought');
      expect(thoughtMsgs.length).toBeGreaterThanOrEqual(1);
      expect(thoughtMsgs[0].content.length).toBeGreaterThan(0);
    },
    30000
  );

  itif(testConfig.enabled)(
    'should use type text (not final) for assistant messages',
    async () => {
      const runner = new AgentRunner({
        model: 'glm-5',
        llmClient: client,
      });

      const state = createAgentState({
        name: 'msg-type-test',
        instructions: 'Answer directly and briefly.',
        tools: [],
      });

      const { state: finalState } = await runner.run(state, 'Say hello');
      const messages = finalState.context.messages;

      // No message should have the removed 'final' type
      const finalMsgs = messages.filter((m) => m.type === 'final');
      expect(finalMsgs.length).toBe(0);

      // Assistant messages should use valid types
      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      for (const msg of assistantMsgs) {
        expect(['text', 'thought', 'action']).toContain(msg.type);
      }
    },
    30000
  );
});
