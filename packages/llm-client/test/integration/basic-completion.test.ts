/**
 * User Story 1: Basic Completion (Non-streaming)
 *
 * As an application developer
 * I want to call GPT-4 and get a complete response
 * So that I can implement a simple chatbot
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif } from './config';

describe('Integration: Basic Completion (User Story 1)', () => {
  let client: LLMClient;

  beforeAll(() => {
    client = new LLMClient({
      baseUrl: testConfig.baseUrl,
    });

    if (testConfig.enabled) {
      // Register provider with default concurrency
      client.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 5,
      });

      // Register API key
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

  itif(testConfig.enabled)(
    'should get a complete response with content and token stats',
    async () => {
      // Given: A simple chat message
      const messages = [
        { role: 'user' as const, content: 'Say "Hello, World!" and nothing else.' },
      ];

      // When: Call the LLM
      const response = await client.call({
        model: testConfig.testModel,
        messages,
        requestTimeout: 30000, // 30s timeout for the request
      });

      // Then: Verify response structure
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.tokens.input).toBeGreaterThan(0);
      expect(response.tokens.output).toBeGreaterThan(0);
      expect(response.stopReason).toBeDefined();

      console.log('Response:', response.content);
      console.log('Tokens:', response.tokens);
    },
    60000
  );

  itif(testConfig.enabled)(
    'should respect request timeout',
    async () => {
      // Given: A very short timeout
      const messages = [
        { role: 'user' as const, content: 'Write a long essay about artificial intelligence.' },
      ];

      // When & Then: Should timeout
      await expect(
        client.call({
          model: testConfig.testModel,
          messages,
          requestTimeout: 1, // 1ms - intentionally short to trigger timeout
        })
      ).rejects.toThrow('timeout');
    },
    10000
  );

  itif(testConfig.enabled)(
    'should support multi-turn conversation',
    async () => {
      // Given: A multi-turn conversation
      const messages = [
        { role: 'user' as const, content: 'My name is Alice.' },
        { role: 'assistant' as const, content: 'Hello Alice! Nice to meet you.' },
        { role: 'user' as const, content: 'What is my name?' },
      ];

      // When: Continue the conversation
      const response = await client.call({
        model: testConfig.testModel,
        messages,
      });

      // Then: Model should remember the context
      expect(response.content.toLowerCase()).toContain('alice');
      console.log('Context-aware response:', response.content);
    },
    60000
  );
});
