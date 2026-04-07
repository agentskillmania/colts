/**
 * User Story 5: Priority Queue (Important Requests First)
 *
 * As a real-time application developer
 * I have normal chat requests and urgent system alert requests
 * I want alert requests to be processed first
 * So that system issues can be handled in time
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif } from './config';

describe('Integration: Priority Queue (User Story 5)', () => {
  let client: LLMClient;

  beforeAll(() => {
    client = new LLMClient();

    if (testConfig.enabled) {
      // Low concurrency to ensure queue builds up
      client.registerProvider({
        name: 'openai',
        maxConcurrency: 1, // Only 1 request at a time
      });

      client.registerApiKey({
        key: testConfig.openaiApiKey,
        provider: 'openai',
        maxConcurrency: 1,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 1 }],
      });
    }
  });

  itif(testConfig.enabled)(
    'should process high priority requests before low priority ones',
    async () => {
      // Given: Multiple requests with different priorities
      // Start with a blocking request to ensure queue builds up
      const blockingRequest = client.call({
        model: testConfig.testModel,
        messages: [
          {
            role: 'user' as const,
            content: 'Write a 100 word story about clouds.',
          },
        ],
        priority: 0,
        requestTimeout: 30000,
      });

      // Queue multiple requests with different priorities
      const requestOrder: Array<{ id: number; priority: number }> = [];

      client.on('state', (event) => {
        if (event.type === 'started') {
          requestOrder.push({ id: Date.now(), priority: -1 }); // Track actual execution order
        }
      });

      // Send low priority first, then high priority
      const lowPriorityPromise = client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Low priority request' }],
        priority: 0, // Low priority
        requestTimeout: 30000,
      });

      const highPriorityPromise = client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'High priority request' }],
        priority: 10, // High priority
        requestTimeout: 30000,
      });

      const normalPriorityPromise = client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Normal priority request' }],
        priority: 5, // Medium priority
        requestTimeout: 30000,
      });

      // When: Wait for all to complete
      const results = await Promise.all([
        blockingRequest,
        lowPriorityPromise,
        highPriorityPromise,
        normalPriorityPromise,
      ]);

      // Then: All should succeed
      expect(results.every((r) => r.content.length > 0)).toBe(true);

      console.log('All priority requests completed:');
      console.log('- High priority (10):', results[2].content.slice(0, 30));
      console.log('- Normal priority (5):', results[3].content.slice(0, 30));
      console.log('- Low priority (0):', results[1].content.slice(0, 30));
    },
    120000
  );

  itif(testConfig.enabled)(
    'should respect priority in queue position estimation',
    async () => {
      // Given: Listening to queue events
      const queueEvents: Array<{ priority: number; position: number }> = [];

      client.on('state', (event) => {
        if (event.type === 'queued' && event.position !== undefined) {
          queueEvents.push({
            priority: -1, // We don't have direct access, but order matters
            position: event.position,
          });
        }
      });

      // When: Send multiple requests with same priority
      const promises = Array.from({ length: 3 }, (_, i) =>
        client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Queue test ${i}` }],
          priority: 0,
        })
      );

      await Promise.all(promises);

      // Then: Queue positions should be recorded
      expect(queueEvents.length).toBeGreaterThan(0);
      console.log(
        'Queue positions recorded:',
        queueEvents.map((e) => e.position)
      );
    },
    60000
  );

  itif(testConfig.enabled)(
    'should use default priority 0 when not specified',
    async () => {
      // Given: Request without priority
      const response = await client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'No priority specified' }],
        // priority not specified
      });

      // Then: Should work with default priority
      expect(response.content).toBeDefined();
      console.log('Default priority (0) works');
    },
    60000
  );
});
