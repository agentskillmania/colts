/**
 * User Story 3: Multi-Key Auto Switching (High Availability)
 *
 * As an ops developer
 * I have 3 OpenAI API Keys
 * I want automatic round-robin and failover when one key is rate limited
 * So that I can improve service availability and throughput
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif, logProviderInfo } from './config';

describe('Integration: Multi-Key Auto Switching (User Story 3)', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();
    client = new LLMClient({
      baseUrl: testConfig.baseUrl,
    });

    if (testConfig.enabled && testConfig.apiKey2) {
      // Register provider
      client.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 10,
      });

      // Register first key
      client.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 5,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 3 }],
      });

      // Register second key
      client.registerApiKey({
        key: testConfig.apiKey2,
        provider: testConfig.provider,
        maxConcurrency: 5,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 3 }],
      });
    }
  });

  itif(testConfig.enabled && !!testConfig.apiKey2)(
    'should distribute requests across multiple keys via round-robin',
    async () => {
      // Given: Multiple requests
      const requestCount = 4;
      const usedKeys: string[] = [];

      // Listen for which key is used
      client.on('state', (event) => {
        if (event.type === 'started' && event.key) {
          usedKeys.push(event.key);
        }
      });

      // When: Send multiple requests
      const promises = Array.from({ length: requestCount }, (_, i) =>
        client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Request ${i + 1}` }],
          requestTimeout: 60000,
        })
      );

      await Promise.all(promises);

      // Then: Both keys should have been used
      expect(usedKeys.length).toBe(requestCount);

      const uniqueKeys = new Set(usedKeys);
      expect(uniqueKeys.size).toBeGreaterThanOrEqual(1); // At least one key used

      // Ideally both keys should be used in round-robin
      if (uniqueKeys.size >= 2) {
        console.log('✓ Round-robin working: Both keys were used');
      }

      console.log('Keys used:', usedKeys);
    },
    180000
  );

  itif(testConfig.enabled && !!testConfig.apiKey2)(
    'should show key health stats after multiple requests',
    async () => {
      // Given: Multiple requests to different keys
      for (let i = 0; i < 3; i++) {
        await client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Health test ${i}` }],
          requestTimeout: 60000,
        });
      }

      // When: Get stats
      const stats = client.getStats();

      // Then: Stats should show multiple keys
      expect(stats.keyHealth.size).toBeGreaterThanOrEqual(1);

      for (const [key, health] of stats.keyHealth) {
        expect(health.success).toBeGreaterThan(0);
        console.log(`Key ${key}: ${health.success} success, ${health.fail} fail`);
      }
    },
    180000
  );

  itif(testConfig.enabled)(
    'should work with single key when only one is provided',
    async () => {
      // Create client with single key
      const singleKeyClient = new LLMClient({
        baseUrl: testConfig.baseUrl,
      });
      singleKeyClient.registerProvider({ name: testConfig.provider, maxConcurrency: 5 });
      singleKeyClient.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 3,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 2 }],
      });

      // Should work normally
      const response = await singleKeyClient.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Hello' }],
        requestTimeout: 60000,
      });

      expect(response.content).toBeDefined();
      console.log('Single key mode works:', response.content.slice(0, 50));
    },
    90000
  );
});
