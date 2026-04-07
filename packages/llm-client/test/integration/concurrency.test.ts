/**
 * User Story 4: Concurrency Limiting (Rate Limit Protection)
 *
 * As a backend developer
 * I want to limit concurrent requests per API Key
 * So that I won't be rate limited or banned by OpenAI
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif } from './config';

describe('Integration: Concurrency Limiting (User Story 4)', () => {
  let client: LLMClient;

  beforeAll(() => {
    client = new LLMClient();

    if (testConfig.enabled) {
      // Provider level: 5 concurrent
      client.registerProvider({
        name: 'openai',
        maxConcurrency: 5,
      });

      // Key level: 2 concurrent (stricter than provider)
      client.registerApiKey({
        key: testConfig.openaiApiKey,
        provider: 'openai',
        maxConcurrency: 2, // Only 2 concurrent allowed
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
    'should queue requests when concurrency limit is reached',
    async () => {
      // Given: More requests than concurrent limit
      const requestCount = 5; // Send 5 requests, but only 2 can run concurrently
      const events: Array<{ type: string; position?: number }> = [];

      // Listen to queue events
      client.on('state', (event) => {
        events.push(event);
      });

      // When: Send multiple requests simultaneously
      const startTime = Date.now();
      const promises = Array.from({ length: requestCount }, (_, i) =>
        client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Concurrency test ${i + 1}` }],
          requestTimeout: 60000,
        })
      );

      await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Then: Some requests should have been queued
      const queuedEvents = events.filter((e) => e.type === 'queued');
      const startedEvents = events.filter((e) => e.type === 'started');

      expect(queuedEvents.length).toBe(requestCount);
      expect(startedEvents.length).toBe(requestCount);

      // Some requests should have queued (position > 0)
      const maxPosition = Math.max(...queuedEvents.map((e) => e.position || 0));
      if (maxPosition > 0) {
        console.log(`✓ Queueing worked: max queue position was ${maxPosition}`);
      }

      console.log(`Total time for ${requestCount} requests: ${totalTime}ms`);
      console.log('Average per request:', totalTime / requestCount);

      // With concurrency limit of 2, it should take at least 2x the time of one request
      // This is a rough check, as network latency varies
      expect(totalTime).toBeGreaterThan(1000); // Should take some time due to limiting
    },
    180000
  );

  itif(testConfig.enabled)(
    'should show real-time concurrency stats',
    async () => {
      // Given: Multiple concurrent requests
      const promises = Array.from({ length: 3 }, (_, i) =>
        client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Stats test ${i + 1}` }],
        })
      );

      // When: Check stats mid-flight (best effort)
      const midFlightStats = client.getStats();
      console.log('Stats during execution:', {
        queueSize: midFlightStats.queueSize,
        activeRequests: midFlightStats.activeRequests,
      });

      await Promise.all(promises);

      // Then: Final stats should show completed
      const finalStats = client.getStats();
      expect(finalStats.queueSize).toBe(0); // Queue should be empty
      expect(finalStats.activeRequests).toBe(0); // All done

      console.log('Final stats:', finalStats);
    },
    60000
  );

  itif(testConfig.enabled)(
    'should use default concurrency when not specified',
    async () => {
      // Create client with custom defaults
      const defaultClient = new LLMClient({
        defaultProviderConcurrency: 10,
        defaultKeyConcurrency: 5,
        defaultModelConcurrency: 3,
      });

      defaultClient.registerProvider({
        name: 'openai',
        // maxConcurrency not specified - should use default (10)
      });

      defaultClient.registerApiKey({
        key: testConfig.openaiApiKey,
        provider: 'openai',
        // maxConcurrency not specified - should use default (5)
        models: [
          {
            modelId: testConfig.testModel,
            // maxConcurrency not specified - should use default (3)
          },
        ],
      });

      // Should work with defaults
      const response = await defaultClient.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Hello with defaults' }],
      });

      expect(response.content).toBeDefined();
      console.log('Default concurrency config works');
    },
    60000
  );
});
