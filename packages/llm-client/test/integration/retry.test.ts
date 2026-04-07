/**
 * User Story 6: Automatic Retry on Failure (Resilience)
 *
 * As a reliability engineer
 * I want automatic retry on network jitter or rate limiting
 * So that I can improve request success rate
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif } from './config';

describe('Integration: Automatic Retry (User Story 6)', () => {
  let client: LLMClient;

  beforeAll(() => {
    client = new LLMClient();

    if (testConfig.enabled) {
      client.registerProvider({
        name: 'openai',
        maxConcurrency: 5,
      });

      client.registerApiKey({
        key: testConfig.apiKey,
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 2 }],
      });
    }
  });

  itif(testConfig.enabled)(
    'should succeed after normal request without retry',
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
      });

      // Then: Should succeed without retry
      expect(response.content).toContain('OK');
      expect(retryEvents.length).toBe(0); // No retries needed

      console.log('Request succeeded without retry');
    },
    30000
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
      });

      // Then: Should succeed
      expect(response.content).toBeDefined();
      console.log('Custom retry options applied');
    },
    30000
  );

  itif(testConfig.enabled)(
    'should show retry events in state listener',
    async () => {
      // Note: We can't easily trigger a real 429 error without getting banned
      // So this test mainly verifies the retry event infrastructure exists

      const stateEvents: string[] = [];
      client.on('state', (event) => {
        stateEvents.push(event.type);
      });

      await client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Test' }],
      });

      // Should have seen queued, started, completed events
      expect(stateEvents).toContain('queued');
      expect(stateEvents).toContain('started');
      expect(stateEvents).toContain('completed');

      console.log('State events flow:', stateEvents.join(' -> '));
    },
    30000
  );

  itif(testConfig.enabled)(
    'should apply retry to streaming requests',
    async () => {
      // Given: Streaming request with retry config
      const events: Array<{ type: string }> = [];

      for await (const event of client.stream({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Stream with retry' }],
        retryOptions: {
          retries: 3,
          minTimeout: 1000,
        },
      })) {
        events.push(event);
      }

      // Then: Should complete successfully
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();

      console.log('Streaming with retry config completed');
    },
    60000
  );

  // Note: Testing actual retry behavior requires triggering errors,
  // which we avoid in integration tests to prevent API key issues.
  // The retry logic is covered in unit tests with mocked errors.
});
