/**
 * User Story 7: Monitoring and Debugging (Observability)
 *
 * As an operations engineer
 * I want to view current queue status and key health
 * So that I can detect and troubleshoot issues in time
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif, logProviderInfo } from './config';

describe('Integration: Monitoring and Debugging (User Story 7)', () => {
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
    'should provide real-time stats via getStats()',
    async () => {
      // Given: Initial state
      const initialStats = client.getStats();

      // Then: Should show empty state
      expect(initialStats.queueSize).toBe(0);
      expect(initialStats.activeRequests).toBe(0);
      expect(initialStats.keyHealth.size).toBeGreaterThan(0);
      expect(initialStats.providerActiveCounts.has(testConfig.provider)).toBe(true);

      console.log('Initial stats:', {
        queueSize: initialStats.queueSize,
        activeRequests: initialStats.activeRequests,
        keys: Array.from(initialStats.keyHealth.keys()),
      });

      // When: Make a request
      const requestPromise = client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Stats test' }],
        requestTimeout: 60000,
      });

      // Check stats during execution (may or may not catch active state)
      const midStats = client.getStats();
      console.log('Mid-execution stats:', {
        queueSize: midStats.queueSize,
        activeRequests: midStats.activeRequests,
      });

      await requestPromise;

      // Then: Final stats should show completed
      const finalStats = client.getStats();
      expect(finalStats.queueSize).toBe(0);

      // Key health should show success
      for (const [key, health] of finalStats.keyHealth) {
        expect(health.success).toBeGreaterThan(0);
        console.log(`Key ${key.slice(0, 8)}...: ${health.success} success`);
      }
    },
    90000
  );

  itif(testConfig.enabled)(
    'should emit state events for request lifecycle',
    async () => {
      // Given: Event tracking
      const lifecycle: string[] = [];
      const details: Array<{ type: string; requestId?: string; duration?: number }> = [];

      client.on('state', (event) => {
        lifecycle.push(event.type);
        details.push({
          type: event.type,
          requestId: event.requestId,
          duration: event.duration,
        });
      });

      // When: Make a request with custom ID
      const customRequestId = `observability-test-${Date.now()}`;
      await client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Lifecycle test' }],
        requestId: customRequestId,
        requestTimeout: 60000,
      });

      // Then: Should see complete lifecycle
      expect(lifecycle).toContain('queued');
      expect(lifecycle).toContain('started');
      expect(lifecycle).toContain('completed');

      // Events should have requestId
      expect(details.every((d) => d.requestId === customRequestId)).toBe(true);

      // Completed event should have duration
      const completedEvent = details.find((d) => d.type === 'completed');
      expect(completedEvent?.duration).toBeDefined();
      expect(completedEvent!.duration).toBeGreaterThan(0);

      console.log('Request lifecycle:', lifecycle.join(' -> '));
      console.log(`Duration: ${completedEvent?.duration}ms`);
    },
    90000
  );

  itif(testConfig.enabled)(
    'should track key health over multiple requests',
    async () => {
      // Given: Make multiple requests
      const requestCount = 3;

      for (let i = 0; i < requestCount; i++) {
        await client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Health check ${i}` }],
          requestTimeout: 60000,
        });
      }

      // When: Get stats
      const stats = client.getStats();

      // Then: Should show accumulated health data
      let totalSuccess = 0;
      for (const [key, health] of stats.keyHealth) {
        totalSuccess += health.success;
        console.log(`Key ${key.slice(0, 8)}...: ${health.success} success, ${health.fail} fail`);
      }

      expect(totalSuccess).toBeGreaterThanOrEqual(requestCount);
    },
    120000
  );

  itif(testConfig.enabled)(
    'should show provider and key active counts',
    async () => {
      // Given: Initial state
      const stats1 = client.getStats();

      // Then: Provider should be registered
      expect(stats1.providerActiveCounts.has(testConfig.provider)).toBe(true);
      expect(stats1.keyActiveCounts.size).toBeGreaterThan(0);

      console.log('Provider counts:', Object.fromEntries(stats1.providerActiveCounts));
      console.log('Key counts:', Object.fromEntries(stats1.keyActiveCounts));
    },
    60000
  );

  itif(testConfig.enabled)(
    'should support clear() to reset all state',
    async () => {
      // Given: Make a request first
      await client.call({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Before clear' }],
        requestTimeout: 60000,
      });

      const statsBefore = client.getStats();
      expect(statsBefore.keyHealth.size).toBeGreaterThan(0);

      // When: Clear all state
      client.clear();

      // Then: Stats should be reset
      const statsAfter = client.getStats();
      expect(statsAfter.providerActiveCounts.size).toBe(0);
      expect(statsAfter.keyHealth.size).toBe(0);

      console.log('Clear() successfully reset all state');
    },
    60000
  );
});
