/**
 * RequestScheduler unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestScheduler } from '../../src/scheduler';

describe('RequestScheduler', () => {
  let scheduler: RequestScheduler;

  beforeEach(() => {
    scheduler = new RequestScheduler();
  });

  describe('provider registration', () => {
    it('should register a provider', () => {
      scheduler.registerProvider({
        name: 'openai',
        maxConcurrency: 10,
      });

      const stats = scheduler.getStats();
      expect(stats.providerActiveCounts.has('openai')).toBe(true);
    });

    it('should throw on duplicate provider', () => {
      scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });

      expect(() => {
        scheduler.registerProvider({ name: 'openai', maxConcurrency: 5 });
      }).toThrow('already registered');
    });
  });

  describe('API key registration', () => {
    it('should register an API key', () => {
      scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
      scheduler.registerApiKey({
        key: 'sk-test123',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      const stats = scheduler.getStats();
      expect(stats.keyHealth.size).toBe(1);
    });

    it('should require provider to exist', () => {
      expect(() => {
        scheduler.registerApiKey({
          key: 'sk-test',
          provider: 'non-existent',
          maxConcurrency: 3,
          models: [],
        });
      }).toThrow('not registered');
    });
  });

  describe('round-robin key selection', () => {
    it('should rotate between multiple keys for same model', async () => {
      scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });

      const usedKeys: string[] = [];

      // Register two keys
      scheduler.registerApiKey({
        key: 'sk-key1',
        provider: 'openai',
        maxConcurrency: 10,
        models: [{ modelId: 'gpt-4', maxConcurrency: 5 }],
      });
      scheduler.registerApiKey({
        key: 'sk-key2',
        provider: 'openai',
        maxConcurrency: 10,
        models: [{ modelId: 'gpt-4', maxConcurrency: 5 }],
      });

      // Execute multiple requests and track which key was used
      const executor = async (key: { key: string }) => {
        usedKeys.push(key.key);
        return 'result';
      };

      await scheduler.execute('gpt-4', 0, executor);
      await scheduler.execute('gpt-4', 0, executor);
      await scheduler.execute('gpt-4', 0, executor);
      await scheduler.execute('gpt-4', 0, executor);

      // Should have used both keys (4 requests, 2 keys)
      expect(usedKeys.length).toBe(4);
      // Both keys should have been used
      const uniqueKeys = new Set(usedKeys);
      expect(uniqueKeys.size).toBe(2);
      // Each key should have been used at least once
      expect(usedKeys.filter((k) => k === 'sk-key1').length).toBeGreaterThanOrEqual(1);
      expect(usedKeys.filter((k) => k === 'sk-key2').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('concurrency limits', () => {
    it('should respect provider concurrency limit', async () => {
      scheduler.registerProvider({ name: 'openai', maxConcurrency: 2 });
      scheduler.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 10,
        models: [{ modelId: 'gpt-4', maxConcurrency: 10 }],
      });

      let running = 0;
      let maxRunning = 0;

      const executor = async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 50));
        running--;
        return 'done';
      };

      // Start 5 concurrent requests
      await Promise.all(
        Array(5)
          .fill(null)
          .map(() => scheduler.execute('gpt-4', 0, executor))
      );

      expect(maxRunning).toBeLessThanOrEqual(2);
    });
  });

  describe('events', () => {
    it('should emit queued event', async () => {
      scheduler.registerProvider({ name: 'openai', maxConcurrency: 1 });
      scheduler.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 1,
        models: [{ modelId: 'gpt-4', maxConcurrency: 1 }],
      });

      const events: Array<{ type: string; position?: number; estimatedWait?: number }> = [];

      scheduler.on('state', (event) => {
        if (event.type === 'queued') {
          events.push(event);
        }
      });

      await scheduler.execute('gpt-4', 0, async () => 'result');

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].position).toBeDefined();
      expect(events[0].estimatedWait).toBeDefined();
    });

    it('should emit started event', async () => {
      scheduler.registerProvider({ name: 'openai', maxConcurrency: 1 });
      scheduler.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 1,
        models: [{ modelId: 'gpt-4', maxConcurrency: 1 }],
      });

      const events: Array<{ type: string; key?: string; model?: string }> = [];

      scheduler.on('state', (event) => {
        if (event.type === 'started') {
          events.push(event);
        }
      });

      await scheduler.execute('gpt-4', 0, async () => 'result');

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].key).toBeDefined();
      expect(events[0].model).toBe('gpt-4');
    });
  });
});

describe('Scheduler error handling', () => {
  it('should emit retry event', () => {
    const scheduler = new RequestScheduler();
    const events: Array<{ type: string }> = [];

    scheduler.on('state', (event) => {
      events.push(event);
    });

    scheduler.emitRetry('req-123', 2, new Error('Test error'));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('retry');
  });

  it('should handle executor errors', async () => {
    const scheduler = new RequestScheduler();
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    await expect(
      scheduler.execute('gpt-4', 0, async () => {
        throw new Error('Executor failed');
      })
    ).rejects.toThrow('Executor failed');
  });
});

describe('Scheduler default concurrency', () => {
  it('should use default provider concurrency when not specified', () => {
    const scheduler = new RequestScheduler({
      defaultProviderConcurrency: 20,
      defaultKeyConcurrency: 10,
      defaultModelConcurrency: 5,
    });

    scheduler.registerProvider({ name: 'openai', maxConcurrency: undefined as unknown as number });

    const stats = scheduler.getStats();
    expect(stats.providerActiveCounts.has('openai')).toBe(true);
  });

  it('should use default key concurrency when not specified', () => {
    const scheduler = new RequestScheduler({
      defaultProviderConcurrency: 10,
      defaultKeyConcurrency: 8,
      defaultModelConcurrency: 4,
    });

    scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: undefined as unknown as number,
      models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
    });

    const stats = scheduler.getStats();
    expect(stats.keyHealth.size).toBe(1);
  });

  it('should use default model concurrency when not specified', () => {
    const scheduler = new RequestScheduler({
      defaultProviderConcurrency: 10,
      defaultKeyConcurrency: 5,
      defaultModelConcurrency: 3,
    });

    scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: undefined as unknown as number }],
    });

    expect(scheduler.getStats().keyHealth.size).toBe(1);
  });
});

// T4: Regression test — activeRequests should return to zero after concurrent requests complete (CR scheduler leak)
describe('concurrent request cleanup (CR T4)', () => {
  it('should have zero activeRequests after all concurrent requests complete', async () => {
    const scheduler = new RequestScheduler();
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 1, // Capacity 1, test queuing
      models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
    });

    // Create multiple concurrent requests
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(scheduler.execute('gpt-4', 0, async () => `response-${i}`));
    }

    await Promise.all(requests);

    // After all requests complete, activeRequests should be 0
    const stats = scheduler.getStats();
    let totalActive = 0;
    for (const [, count] of stats.providerActiveCounts) {
      totalActive += count;
    }
    expect(totalActive).toBe(0);
  });
});

describe('AbortSignal support', () => {
  let scheduler: RequestScheduler;

  beforeEach(() => {
    scheduler = new RequestScheduler();
  });

  it('should reject immediately when signal is already aborted (PQueue early check)', async () => {
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      scheduler.execute('gpt-4', 0, async () => 'result', undefined, controller.signal)
    ).rejects.toThrow();
  });

  it('should respond to abort while waiting for semaphore (Semaphore interruption)', async () => {
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 1 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 1,
      models: [{ modelId: 'gpt-4', maxConcurrency: 1 }],
    });

    const controller = new AbortController();
    let resolveBlock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      resolveBlock = r;
    });

    // Fill all concurrency slots
    const running = scheduler.execute('gpt-4', 0, async () => {
      await blockPromise;
      return 'blocked';
    });

    // Queue and abort later
    const abortPromise = scheduler.execute(
      'gpt-4',
      0,
      async () => 'should-not-reach',
      undefined,
      controller.signal
    );

    // Ensure queued request has entered waiting state
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    try {
      await abortPromise;
      expect.unreachable('Should throw AbortError');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe('AbortError');
    }

    // Release blocking request
    resolveBlock();
    await running;
  });

  it('semaphore should not leak after abort — subsequent requests execute normally', async () => {
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 1 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 1,
      models: [{ modelId: 'gpt-4', maxConcurrency: 1 }],
    });

    const controller = new AbortController();
    let resolveBlock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      resolveBlock = r;
    });

    // Fill up
    const running = scheduler.execute('gpt-4', 0, async () => {
      await blockPromise;
      return 'blocked';
    });

    // Abort queued request
    const abortPromise = scheduler.execute(
      'gpt-4',
      0,
      async () => 'should-not-reach',
      undefined,
      controller.signal
    );

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await expect(abortPromise).rejects.toThrow();

    // Release blocking
    resolveBlock();
    await running;

    // Subsequent request should execute normally
    const result = await scheduler.execute('gpt-4', 0, async () => 'ok');
    expect(result).toBe('ok');

    // activeRequests should return to zero
    const stats = scheduler.getStats();
    let totalActive = 0;
    for (const [, count] of stats.providerActiveCounts) {
      totalActive += count;
    }
    expect(totalActive).toBe(0);
  });

  it('execute should work without signal (backward compatible)', async () => {
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 10 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const result = await scheduler.execute('gpt-4', 0, async () => 'result');
    expect(result).toBe('result');
  });

  it('abort during semaphore wait should correctly release acquired semaphore', async () => {
    // Test intermediate semaphore release with different provider/key/model concurrency limits
    scheduler.registerProvider({ name: 'openai', maxConcurrency: 1 });
    scheduler.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 1,
      models: [{ modelId: 'gpt-4', maxConcurrency: 1 }],
    });

    // Register a second key to ensure round-robin does not interfere
    scheduler.registerApiKey({
      key: 'sk-test2',
      provider: 'openai',
      maxConcurrency: 1,
      models: [{ modelId: 'gpt-4', maxConcurrency: 1 }],
    });

    const controller = new AbortController();
    let resolveBlock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      resolveBlock = r;
    });

    // Fill sk-test slots
    const running = scheduler.execute(
      'gpt-4',
      0,
      async () => {
        await blockPromise;
        return 'blocked';
      },
      undefined
    );

    // Queue for sk-test slot, then abort
    const abortPromise = scheduler.execute(
      'gpt-4',
      0,
      async () => 'should-not-reach',
      undefined,
      controller.signal
    );

    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await expect(abortPromise).rejects.toThrow();

    resolveBlock();
    await running;

    // After both requests, all semaphores should return to zero
    const stats = scheduler.getStats();
    for (const [, count] of stats.providerActiveCounts) {
      expect(count).toBe(0);
    }
    for (const [, count] of stats.keyActiveCounts) {
      expect(count).toBe(0);
    }
  });
});
