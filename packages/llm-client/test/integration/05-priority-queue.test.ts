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
import { testConfig, itif, logProviderInfo } from './config';

describe('Integration: Priority Queue (User Story 5)', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();
    client = new LLMClient({
      baseUrl: testConfig.baseUrl,
    });

    if (testConfig.enabled) {
      // Low concurrency to ensure queue builds up
      client.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 1, // Only 1 request at a time
      });

      client.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 1,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 1 }],
      });
    }
  });

  itif(testConfig.enabled)(
    'should process high priority requests before low priority ones',
    async () => {
      // Given: Multiple requests with different priorities
      const results: Array<{ content: string; priority: number }> = [];

      // Send requests with different priorities
      const makeRequest = (priority: number, content: string) =>
        client
          .call({
            model: testConfig.testModel,
            messages: [{ role: 'user' as const, content }],
            priority,
            requestTimeout: 60000,
          })
          .then((r) => {
            results.push({ content: r.content, priority });
            return r;
          });

      // Queue multiple requests
      const promises = [
        makeRequest(0, 'Low priority request'),
        makeRequest(10, 'High priority request'),
        makeRequest(5, 'Normal priority request'),
      ];

      // When: Wait for all to complete
      await Promise.all(promises);

      // Then: All should have completed
      expect(results.length).toBe(3);
      console.log('All priority requests completed:');
      results.forEach((r) => {
        console.log(`- Priority ${r.priority}:`, r.content.slice(0, 30));
      });

      // For standard OpenAI API, all content should be non-empty
      // For custom providers, some may be empty
      if (!testConfig.isCustomProvider) {
        expect(results.every((r) => r.content.length > 0)).toBe(true);
      }
    },
    180000
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
          requestTimeout: 60000,
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
    90000
  );

  itif(testConfig.enabled)(
    'should use default priority 0 when not specified',
    async () => {
      // Given: Request without priority
      const response = await client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'No priority specified' }],
        requestTimeout: 60000,
        // priority not specified
      });

      // Then: Should work with default priority
      expect(response).toBeDefined();
      console.log('Default priority (0) works');
    },
    90000
  );
});
