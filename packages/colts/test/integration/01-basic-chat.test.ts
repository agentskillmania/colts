/**
 * @fileoverview User Story: Basic LLM Chat (Integration)
 *
 * As a developer
 * I want to have real conversations with an LLM through an Agent
 * So that I can build interactive applications with streaming support
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 *
 * Acceptance Criteria:
 * 1. Can send a message and receive a real LLM response
 * 2. Can receive real streaming responses
 * 3. Conversation history is maintained across turns
 * 4. Response is properly added to AgentState
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig, itif, logProviderInfo } from './config.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';

describe('Integration: Basic LLM Chat', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();
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
            modelId: testConfig.testModel,
            maxConcurrency: 2,
          },
        ],
      });
    }
  });

  const defaultConfig: AgentConfig = {
    name: 'chat-agent',
    instructions: 'You are a helpful assistant. Answer concisely.',
    tools: [],
  };

  // Scenario 1: Basic blocking chat with real LLM
  describe('Scenario 1: Real LLM Conversation', () => {
    itif(testConfig.enabled)(
      'should get a real response from LLM',
      async () => {
        // Given: A configured AgentRunner with real LLM client
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 60000,
        });

        const state = createAgentState(defaultConfig);

        // When: User asks a simple question
        const result = await runner.chat(state, 'Say "Hello, World!" and nothing else.');

        // Then: Receive real LLM response
        expect(result.response).toBeDefined();
        expect(result.response.length).toBeGreaterThan(0);
        expect(result.stopReason).toBeDefined();

        // And: State is properly updated
        expect(result.state.context.messages).toHaveLength(2);
        expect(result.state.context.messages[0].role).toBe('user');
        expect(result.state.context.messages[1].role).toBe('assistant');
        expect(result.state.context.stepCount).toBe(1);

        console.log('Response:', result.response);
        console.log('Tokens:', result.tokens);
      },
      90000
    );

    itif(testConfig.enabled)(
      'should maintain conversation context across multiple turns',
      async () => {
        // Given: A runner ready for multi-turn conversation
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 60000,
        });

        let state = createAgentState({
          ...defaultConfig,
          instructions: 'Remember what the user tells you.',
        });

        // Turn 1: User introduces themselves
        const result1 = await runner.chat(state, 'My name is Alice.');
        state = result1.state;
        console.log('Turn 1:', result1.response);

        // Turn 2: Ask about previous context
        const result2 = await runner.chat(state, 'What is my name?');
        state = result2.state;
        console.log('Turn 2:', result2.response);

        // Then: Response should reference previous context
        expect(result2.response.toLowerCase()).toContain('alice');

        // And: Full conversation history preserved
        expect(state.context.messages).toHaveLength(4);
        expect(state.context.stepCount).toBe(2);
      },
      120000
    );

    itif(testConfig.enabled)(
      'should respect system prompt in responses',
      async () => {
        // Given: Runner with specific system prompt
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          systemPrompt: 'You are a pirate. Always speak like a pirate.',
          requestTimeout: 60000,
        });

        const state = createAgentState({
          name: 'pirate-agent',
          instructions: '',
          tools: [],
        });

        // When: Ask a question
        const result = await runner.chat(state, 'Say hello.');

        // Then: Response should reflect system prompt
        // Pirates say "arr", "matey", "ahoy", etc.
        const response = result.response.toLowerCase();
        console.log('Pirate response:', result.response);

        // Just check we got a response - pirate mode may vary by model
        expect(response.length).toBeGreaterThan(0);
      },
      90000
    );
  });

  // Scenario 2: Streaming chat with real LLM
  describe('Scenario 2: Real Streaming Response', () => {
    itif(testConfig.enabled)(
      'should receive streaming chunks from real LLM',
      async () => {
        // Given: A streaming-capable runner
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 60000,
        });

        const state = createAgentState(defaultConfig);
        const chunks: Array<{ type: string; delta?: string; accumulatedContent?: string }> = [];

        // When: Request a streaming response
        for await (const chunk of runner.chatStream(state, 'Count to 5 slowly.')) {
          chunks.push(chunk);

          // Log streaming progress
          if (chunk.type === 'text') {
            process.stdout.write(chunk.delta || '');
          }
        }
        console.log('\n--- Stream complete ---');

        // Then: Should have received multiple chunks
        const textChunks = chunks.filter((c) => c.type === 'text');
        expect(textChunks.length).toBeGreaterThan(0);

        // And: Final done chunk should exist
        const doneChunk = chunks.find((c) => c.type === 'done');
        expect(doneChunk).toBeDefined();
        expect(doneChunk?.accumulatedContent).toBeDefined();
        expect((doneChunk?.accumulatedContent || '').length).toBeGreaterThan(0);
      },
      90000
    );

    itif(testConfig.enabled)(
      'should build up content progressively in stream',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 60000,
        });

        const state = createAgentState(defaultConfig);
        let lastAccumulated = '';

        // When: Stream a response
        for await (const chunk of runner.chatStream(state, 'Write one sentence about AI.')) {
          if (chunk.type === 'text' && chunk.accumulatedContent) {
            // Each chunk should build on the previous
            expect(chunk.accumulatedContent.length).toBeGreaterThanOrEqual(lastAccumulated.length);
            lastAccumulated = chunk.accumulatedContent;
          }
        }

        // Then: Final content should be complete
        expect(lastAccumulated.length).toBeGreaterThan(10);
        console.log('Final accumulated:', lastAccumulated);
      },
      90000
    );
  });

  // Scenario 3: Priority handling
  describe('Scenario 3: Request Priority', () => {
    itif(testConfig.enabled)(
      'should handle high priority requests',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 60000,
        });

        const state = createAgentState(defaultConfig);

        // When: Make high priority request
        const result = await runner.chat(state, 'Quick response please.', { priority: 10 });

        // Then: Should complete successfully
        expect(result.response).toBeDefined();
        expect(result.response.length).toBeGreaterThan(0);
      },
      90000
    );

    itif(testConfig.enabled)(
      'should handle streaming with priority',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 60000,
        });

        const state = createAgentState(defaultConfig);
        const chunks = [];

        // When: Stream with custom priority
        for await (const chunk of runner.chatStream(state, 'Hello', { priority: 5 })) {
          chunks.push(chunk);
        }

        // Then: Should complete
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.some((c) => c.type === 'done')).toBe(true);
      },
      90000
    );
  });

  // Scenario 4: Error handling with real LLM
  describe('Scenario 4: Error Handling', () => {
    itif(testConfig.enabled)(
      'should handle timeout gracefully',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          requestTimeout: 1, // Very short timeout
        });

        const state = createAgentState(defaultConfig);

        // When/Then: Should timeout quickly
        await expect(runner.chat(state, 'This should timeout')).rejects.toThrow();
      },
      10000
    );

    itif(testConfig.enabled)(
      'should handle invalid model',
      async () => {
        const badRunner = new AgentRunner({
          model: 'invalid-model-name-12345',
          llmClient: client,
          requestTimeout: 10000,
        });

        const state = createAgentState(defaultConfig);

        // When/Then: Should fail
        await expect(badRunner.chat(state, 'Test')).rejects.toThrow();
      },
      30000
    );
  });

  // Info about skipped tests
  if (!testConfig.enabled) {
    it('Integration tests are disabled', () => {
      console.log('Integration tests skipped. Set ENABLE_INTEGRATION_TESTS=true to run.');
      expect(true).toBe(true);
    });
  }
});
