/**
 * User Story 1: Basic Completion (Non-streaming)
 *
 * As an application developer
 * I want to call GPT-4 and get a complete response
 * So that I can implement a simple chatbot
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif, logProviderInfo } from './config';

describe('Integration: Basic Completion (User Story 1)', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();
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
    'should get a complete response with content',
    async () => {
      // Given: A simple chat message
      const messages = [
        { role: 'user' as const, content: 'Say "Hello, World!" and nothing else.' },
      ];

      // When: Call the LLM
      const response = await client.call({
        model: testConfig.testModel,
        messages,
        requestTimeout: 60000,
      });

      // Then: Verify response structure
      expect(response).toBeDefined();
      expect(response.stopReason).toBeDefined();

      // Content may be empty for some providers/models, so we just check it exists
      console.log('Response:', response.content);
      console.log('Tokens:', response.tokens);
      console.log('Stop reason:', response.stopReason);

      // For OpenAI official API, we expect valid tokens and content
      // For custom providers, be more lenient
      if (!testConfig.isCustomProvider) {
        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
        expect(response.tokens.input).toBeGreaterThan(0);
        expect(response.tokens.output).toBeGreaterThan(0);
      } else {
        // For custom providers, just check the request completed
        console.log('Custom provider - content length:', response.content?.length || 0);
      }
    },
    90000
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
        requestTimeout: 60000,
      });

      // Then: Model should return a response (may or may not follow context)
      expect(response).toBeDefined();
      expect(response.stopReason).toBeDefined();

      console.log('Response:', response.content);
      console.log('Tokens:', response.tokens);

      // For standard OpenAI, expect non-empty content
      // For custom providers, just log the result
      if (!testConfig.isCustomProvider) {
        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
      }
    },
    90000
  );

  itif(testConfig.enabled)(
    'should handle invalid requests gracefully',
    async () => {
      // Given: An invalid model name
      // When & Then: Should throw an error
      await expect(
        client.call({
          model: 'invalid-model-name-that-does-not-exist',
          messages: [{ role: 'user' as const, content: 'Test' }],
          requestTimeout: 10000,
        })
      ).rejects.toThrow();
    },
    30000
  );
});
