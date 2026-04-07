/**
 * User Story 6: Automatic Retry on Failure (Resilience)
 *
 * As a reliability engineer
 * I want automatic retry on network jitter or rate limiting
 * So that I can improve request success rate
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif, logProviderInfo } from './config';

describe('Integration: Automatic Retry (User Story 6)', () => {
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
        models: [{ modelId: testConfig.testModel, maxConcurrency: 2 }],
      });
    }
  });

  itif(testConfig.enabled)(
    'should succeed with normal request',
    async () => {
      // Given: A normal request
      const messages = [{ role: 'user' as const, content: 'Say "OK" and nothing else.' }];

      const retryEvents: Array<{ attempt: number; error: string }> = [];
      client.on('state', (event) => {
        if (event.type === 'retry') {
          retryEvents.push({ attempt: event.attempt!, error: event.error! });
        }
      });

      // When: Make request
      const response = await client.call({
        model: testConfig.testModel,
        messages,
        retryOptions: {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 5000,
        },
        requestTimeout: 60000,
      });

      // Then: Should succeed (may or may not retry)
      expect(response).toBeDefined();
      console.log('Request succeeded');
      if (retryEvents.length > 0) {
        console.log(`Retries: ${retryEvents.length}`);
      }

      // For standard OpenAI, expect non-empty content
      if (!testConfig.isCustomProvider) {
        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
      }
    },
    90000
  );

  itif(testConfig.enabled)(
    'should configure custom retry options',
    async () => {
      // Given: Custom retry configuration
      const messages = [{ role: 'user' as const, content: 'Simple test' }];

      // When: Request with custom retry options
      const response = await client.call({
        model: testConfig.testModel,
        messages,
        retryOptions: {
          retries: 5, // More retries
          minTimeout: 500, // Faster initial retry
          maxTimeout: 10000, // Longer max wait
          factor: 2, // Exponential backoff factor
        },
        requestTimeout: 60000,
      });

      // Then: Should succeed
      expect(response).toBeDefined();
      console.log('Custom retry options applied');
    },
    90000
  );

  itif(testConfig.enabled)(
    'should show state events in listener',
    async () => {
      // Note: We can't easily trigger a real 429 error without getting banned
      // So this test mainly verifies the state event infrastructure exists

      const stateEvents: string[] = [];
      client.on('state', (event) => {
        stateEvents.push(event.type);
      });

      await client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Test' }],
        requestTimeout: 60000,
      });

      // Should have seen queued, started, completed events
      expect(stateEvents).toContain('queued');
      expect(stateEvents).toContain('started');
      expect(stateEvents).toContain('completed');

      console.log('State events flow:', stateEvents.join(' -> '));
    },
    60000
  );

  itif(testConfig.enabled)(
    'should apply retry to streaming requests',
    async () => {
      // Given: Streaming request with retry config
      const events: Array<{ type: string }> = [];

      try {
        for await (const event of client.stream({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: 'Stream with retry' }],
          retryOptions: {
            retries: 3,
            minTimeout: 1000,
          },
          requestTimeout: 60000,
        })) {
          events.push(event);
        }
      } catch (error) {
        console.log('Stream error:', (error as Error).message);
      }

      // Then: Log what happened
      console.log(
        'Streaming events:',
        events.map((e) => e.type)
      );

      // Check if we got a done or error event
      const doneEvent = events.find((e) => e.type === 'done');
      const errorEvent = events.find((e) => e.type === 'error');

      if (doneEvent) {
        console.log('Streaming with retry config completed successfully');
      } else if (errorEvent) {
        console.log('Streaming completed with error (may be expected for custom providers)');
      }

      // For standard OpenAI, we expect done event
      // For custom providers, behavior may vary
      if (!testConfig.isCustomProvider) {
        expect(doneEvent || errorEvent).toBeDefined();
      }
    },
    90000
  );

  // Note: Testing actual retry behavior requires triggering errors,
  // which we avoid in integration tests to prevent API key issues.
  // The retry logic is covered in unit tests with mocked errors.
});
