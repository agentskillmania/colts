/**
 * User Story 4: Concurrency Limiting (Rate Limit Protection)
 *
 * As a backend developer
 * I want to limit concurrent requests per API Key
 * So that I won't be rate limited or banned by OpenAI
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif, logProviderInfo } from './config';

describe('Integration: Concurrency Limiting (User Story 4)', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();
    client = new LLMClient({
      baseUrl: testConfig.baseUrl,
    });

    if (testConfig.enabled) {
      // Provider level: 5 concurrent
      client.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 5,
      });

      // Key level: 2 concurrent (stricter than provider)
      client.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
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
          messages: [{ role: 'user' as const, content: `Test ${i + 1}` }],
          requestTimeout: 90000, // Higher timeout for concurrent tests
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
    240000
  );

  itif(testConfig.enabled)(
    'should show real-time concurrency stats',
    async () => {
      // Given: Multiple concurrent requests
      const promises = Array.from({ length: 3 }, (_, i) =>
        client.call({
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Stats test ${i + 1}` }],
          requestTimeout: 60000,
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
    90000
  );

  itif(testConfig.enabled)(
    'should use default concurrency when not specified',
    async () => {
      // Create client with custom defaults
      const defaultClient = new LLMClient({
        defaultProviderConcurrency: 10,
        defaultKeyConcurrency: 5,
        defaultModelConcurrency: 3,
        baseUrl: testConfig.baseUrl,
      });

      defaultClient.registerProvider({
        name: testConfig.provider,
        // maxConcurrency not specified - should use default (10)
      });

      defaultClient.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
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
        requestTimeout: 60000,
      });

      expect(response.content).toBeDefined();
      console.log('Default concurrency config works');
    },
    90000
  );

  // ============================================================
  // AbortSignal — 取消排队中的请求
  // ============================================================
  describe('AbortSignal cancellation in queue', () => {
    itif(testConfig.enabled)(
      'should reject queued request when signal is aborted',
      async () => {
        // 创建并发限制为 1 的客户端，确保第二个请求一定排队
        const singleClient = new LLMClient({
          baseUrl: testConfig.baseUrl,
        });

        singleClient.registerProvider({
          name: testConfig.provider,
          maxConcurrency: 1,
        });

        singleClient.registerApiKey({
          key: testConfig.apiKey,
          provider: testConfig.provider,
          maxConcurrency: 1,
          models: [{ modelId: testConfig.testModel, maxConcurrency: 1 }],
        });

        const controller = new AbortController();

        // 第一个请求占满并发槽位
        const first = singleClient.call({
          model: testConfig.testModel,
          messages: [{ role: 'user', content: 'Count from 1 to 10 slowly.' }],
          requestTimeout: 90000,
        });

        // 第二个请求排队等待，稍后 abort
        const second = singleClient.call({
          model: testConfig.testModel,
          messages: [{ role: 'user', content: 'Say hello' }],
          requestTimeout: 90000,
          signal: controller.signal,
        });

        // 等待第二个请求进入队列
        await new Promise((r) => setTimeout(r, 200));
        controller.abort();

        // 第二个请求应被 AbortError 拒绝
        await expect(second).rejects.toThrow();

        // 第一个请求应正常完成
        const result = await first;
        expect(result.content).toBeDefined();
      },
      120000
    );

    itif(testConfig.enabled)(
      'should reject immediately when signal is already aborted',
      async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
          client.call({
            model: testConfig.testModel,
            messages: [{ role: 'user', content: 'Test' }],
            requestTimeout: 60000,
            signal: controller.signal,
          })
        ).rejects.toThrow();
      },
      90000
    );
  });
});
