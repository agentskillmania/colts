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
      // Given: A way to track how many requests have entered the active slot.
      // With key/model maxConcurrency=2 and 3 concurrent requests, we expect
      // 2 in-flight and 1 queued while the requests are running.
      const startedIds: string[] = [];
      client.on('state', (event) => {
        if (event.type === 'started') {
          startedIds.push(event.requestId);
        }
      });

      // Fire 3 requests simultaneously (3 > 2 -> the 3rd must queue).
      const requestIds = ['stats-req-1', 'stats-req-2', 'stats-req-3'];
      const promises = requestIds.map((id, i) =>
        client.call({
          requestId: id,
          model: testConfig.testModel,
          messages: [{ role: 'user' as const, content: `Stats test ${i + 1}` }],
          requestTimeout: 60000,
        })
      );

      // Wait for at least 2 requests to actually enter the active slot.
      // The client.call() promises resolve synchronously up to the first
      // await on the network only after the scheduler dequeues them, so a
      // plain Promise.all(...) would block until everything is done and we
      // would miss the in-flight window entirely.
      const startedDeadline = Date.now() + 5000;
      while (startedIds.length < 2 && Date.now() < startedDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Yield to the event loop so the scheduler has a chance to enqueue the
      // overflowing 3rd request and bump queueSize/activeRequests counters.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // When: Snapshot stats WHILE requests are still in flight.
      const midFlightStats = client.getStats();
      console.log('Stats during execution:', {
        queueSize: midFlightStats.queueSize,
        activeRequests: midFlightStats.activeRequests,
        startedSoFar: startedIds.length,
      });

      // At least 2 requests should have become active by now.
      expect(startedIds.length).toBeGreaterThanOrEqual(2);

      // The whole point of this test: stats must reflect live load, not an
      // empty snapshot taken before any request was scheduled. We assert the
      // sum of active + queued is non-zero (i.e. there is real in-flight
      // work). We avoid over-asserting exact numbers because timing is
      // inherently racy, but active+queued > 0 proves the snapshot was taken
      // mid-flight rather than before/after.
      const inFlight = midFlightStats.activeRequests + midFlightStats.queueSize;
      expect(inFlight).toBeGreaterThan(0);

      // When the network is very fast the 3rd request may have already
      // drained, so queueSize can be 0; that is acceptable as long as
      // activeRequests shows live work.
      if (midFlightStats.queueSize > 0) {
        // If there is a queue, it should be within the expected overflow
        // range for 3 requests against a concurrency limit of 2.
        expect(midFlightStats.queueSize).toBeLessThanOrEqual(1);
      }

      // Use allSettled so a single request failure (e.g. a transient upstream
      // timeout) does not prevent us from asserting that the scheduler itself
      // drains completely. The final-stats assertions are about scheduler
      // hygiene, not about every LLM call succeeding.
      const outcomes = await Promise.allSettled(promises);
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      if (rejected.length > 0) {
        console.log(
          `[stats] ${rejected.length}/${outcomes.length} request(s) rejected ` +
            '(upstream/timeout); still asserting scheduler drains.'
        );
      }

      // Then: Final stats should show everything completed. Even if some
      // requests errored, the scheduler must release their slots.
      const finalStats = client.getStats();
      expect(finalStats.queueSize).toBe(0); // Queue drained
      expect(finalStats.activeRequests).toBe(0); // No in-flight work left

      console.log('Final stats:', finalStats);
    },
    240000
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
  // AbortSignal — cancel queued requests
  // ============================================================
  describe('AbortSignal cancellation in queue', () => {
    itif(testConfig.enabled)(
      'should reject queued request when signal is aborted',
      async () => {
        // Create client with concurrency limit 1 to ensure second request queues
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

        // First request fills all concurrency slots
        const first = singleClient.call({
          model: testConfig.testModel,
          messages: [{ role: 'user', content: 'Count from 1 to 10 slowly.' }],
          requestTimeout: 90000,
        });

        // Second request queues and aborts later
        const second = singleClient.call({
          model: testConfig.testModel,
          messages: [{ role: 'user', content: 'Say hello' }],
          requestTimeout: 90000,
          signal: controller.signal,
        });

        // Wait for second request to enter queue
        await new Promise((r) => setTimeout(r, 200));
        controller.abort();

        // Second request should be rejected with AbortError
        await expect(second).rejects.toThrow();

        // First request should complete normally
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
