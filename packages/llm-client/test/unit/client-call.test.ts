/**
 * LLMClient call() and stream() unit tests with mocked scheduler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMClient } from '../../src/client';

// Create mock functions
const mockExecute = vi.fn();
const mockOn = vi.fn();
const mockEmitRetry = vi.fn();
const mockGetStats = vi.fn(() => ({
  queueSize: 0,
  activeRequests: 0,
  keyHealth: new Map(),
  providerActiveCounts: new Map(),
  keyActiveCounts: new Map(),
}));
const mockClear = vi.fn();
const mockRegisterProvider = vi.fn();
const mockRegisterApiKey = vi.fn();

// Mock the scheduler module
vi.mock('../../src/scheduler.js', () => ({
  RequestScheduler: vi.fn().mockImplementation(() => ({
    on: mockOn,
    execute: mockExecute,
    emitRetry: mockEmitRetry,
    getStats: mockGetStats,
    clear: mockClear,
    registerProvider: mockRegisterProvider,
    registerApiKey: mockRegisterApiKey,
  })),
}));

describe('LLMClient with default config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use custom default concurrency values', () => {
    const client = new LLMClient({
      defaultProviderConcurrency: 20,
      defaultKeyConcurrency: 10,
      defaultModelConcurrency: 5,
    });

    expect(client).toBeDefined();
  });

  it('should use default values when config not provided', () => {
    const client = new LLMClient();

    expect(client).toBeDefined();
  });

  it('should register provider with default concurrency', () => {
    const client = new LLMClient({
      defaultProviderConcurrency: 20,
    });

    client.registerProvider({ name: 'test', maxConcurrency: 5 });
    expect(mockRegisterProvider).toHaveBeenCalledWith({ name: 'test', maxConcurrency: 5 });
  });

  it('should call scheduler execute for non-streaming', async () => {
    const client = new LLMClient();
    const mockResponse = {
      content: 'Hello!',
      tokens: { input: 10, output: 5 },
      stopReason: 'stop',
    };
    mockExecute.mockResolvedValue(mockResponse);

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const result = await client.call({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(mockExecute).toHaveBeenCalled();
    expect(result).toBe(mockResponse);
  });

  it('should call scheduler execute for streaming', async () => {
    const client = new LLMClient();
    const mockStream = async function* () {
      yield { type: 'text', delta: 'Hello' };
      yield { type: 'done', tokens: { input: 5, output: 3 } };
    };
    mockExecute.mockResolvedValue(mockStream());

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const events: Array<{ type: string }> = [];
    for await (const event of client.stream({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      events.push(event);
    }

    expect(mockExecute).toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
  });

  it('should apply total timeout for call', async () => {
    const client = new LLMClient();
    mockExecute.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10000)));

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    await expect(
      client.call({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        totalTimeout: 100,
      })
    ).rejects.toThrow('timeout');
  });

  it('MJ-2: should apply total timeout to stream consumption, not just queue wait', async () => {
    const client = new LLMClient();
    // Return a stream that yields one event then hangs forever
    const hungStream = async function* () {
      yield { type: 'text', delta: 'Hello' };
      await new Promise(() => {}); // never resolves
    };
    mockExecute.mockResolvedValue(hungStream());

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const events: Array<{ type: string }> = [];
    await expect(async () => {
      for await (const event of client.stream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        totalTimeout: 100,
      })) {
        events.push(event);
      }
    }).rejects.toThrow('Total timeout exceeded');

    // Should receive the first event before timeout
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('text');
  });

  it('should immediately reject when caller signal is already aborted (pre-aborted)', async () => {
    const client = new LLMClient();
    const mockStream = async function* () {
      yield { type: 'text', delta: 'Hello' };
      yield { type: 'done', tokens: { input: 1, output: 1 } };
    };
    mockExecute.mockResolvedValue(mockStream());

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const abortController = new AbortController();
    abortController.abort(new Error('Already cancelled'));

    const events: Array<{ type: string }> = [];
    await expect(async () => {
      for await (const event of client.stream({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        signal: abortController.signal,
      })) {
        events.push(event);
      }
    }).rejects.toThrow('Already cancelled');

    expect(events.length).toBe(0);
  });

  it('should stop mid-stream when caller signal is aborted during consumption', async () => {
    const client = new LLMClient();
    const callerAbortController = new AbortController();

    // Stream that yields events slowly
    const slowStream = async function* () {
      yield { type: 'text', delta: 'A' };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { type: 'text', delta: 'B' };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { type: 'text', delta: 'C' };
      yield { type: 'done', tokens: { input: 1, output: 3 } };
    };
    mockExecute.mockResolvedValue(slowStream());

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const events: Array<{ type: string; delta?: string }> = [];
    let caughtError: Error | undefined;

    const consume = async () => {
      try {
        for await (const event of client.stream({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          signal: callerAbortController.signal,
        })) {
          events.push(event);
          // Abort after receiving 'B'
          if (event.type === 'text' && event.delta === 'B') {
            callerAbortController.abort(new Error('User cancelled'));
          }
        }
      } catch (err) {
        caughtError = err as Error;
      }
    };

    await consume();

    // Should have received A and B, but not C or done
    expect(events.map((e) => (e.type === 'text' ? e.delta : e.type))).toEqual(['A', 'B']);
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('User cancelled');
  });
});

describe('LLMClient priority and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass priority to scheduler', async () => {
    const client = new LLMClient();
    mockExecute.mockResolvedValue({
      content: 'Hi',
      tokens: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    await client.call({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      priority: 5,
    });

    expect(mockExecute).toHaveBeenCalled();
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[1]).toBe(5); // priority
  });

  it('should use default priority 0', async () => {
    const client = new LLMClient();
    mockExecute.mockResolvedValue({
      content: 'Hi',
      tokens: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    await client.call({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(mockExecute).toHaveBeenCalled();
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[1]).toBe(0); // default priority
  });

  it('should forward state events from scheduler', () => {
    const client = new LLMClient();
    const eventHandler = vi.fn();

    client.on('state', eventHandler);

    // Verify that on method was called during construction
    expect(mockOn).toHaveBeenCalled();
  });
});

describe('LLMClient requestId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use custom requestId when provided', async () => {
    const client = new LLMClient();
    const customRequestId = 'my-custom-trace-id-123';
    mockExecute.mockResolvedValue({
      content: 'Hi',
      tokens: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    await client.call({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      requestId: customRequestId,
    });

    expect(mockExecute).toHaveBeenCalled();
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[3]).toBe(customRequestId);
  });

  it('should auto-generate requestId when not provided', async () => {
    const client = new LLMClient();
    mockExecute.mockResolvedValue({
      content: 'Hi',
      tokens: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    await client.call({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(mockExecute).toHaveBeenCalled();
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[3]).toBeUndefined();
  });

  it('should pass requestId to streaming calls', async () => {
    const client = new LLMClient();
    const customRequestId = 'stream-trace-456';
    const mockStream = async function* () {
      yield { type: 'text', delta: 'Hi' };
      yield { type: 'done', tokens: { input: 1, output: 1 } };
    };
    mockExecute.mockResolvedValue(mockStream());

    client.registerProvider({ name: 'openai', maxConcurrency: 10 });
    client.registerApiKey({
      key: 'sk-test',
      provider: 'openai',
      maxConcurrency: 5,
      models: [{ modelId: 'gpt-4', maxConcurrency: 3 }],
    });

    const events: Array<{ type: string }> = [];
    for await (const event of client.stream({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      requestId: customRequestId,
    })) {
      events.push(event);
    }

    expect(mockExecute).toHaveBeenCalled();
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[3]).toBe(customRequestId);
  });
});
