# @agentskillmania/llm-client

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

A unified LLM client with multi-provider support, three-level concurrency control, priority queuing, round-robin key selection, and comprehensive token tracking.

## Features

- **Multi-Provider Support**: Works with OpenAI, Anthropic, Google, and other providers via the `@mariozechner/pi-ai` library
- **Three-Level Concurrency Control**: Independent limits at Provider → API Key → Model levels to prevent cascading failures
- **Priority Queue**: Higher-priority requests are processed first
- **Round-Robin Key Selection**: Automatic load balancing across multiple API keys for the same model
- **Retry with Exponential Backoff**: Automatic retry on rate limits (429), server errors (5xx), and network issues
- **Token Tracking**: Complete input/output token statistics per request
- **Streaming Support**: Real-time token-by-token responses with `delta` and `accumulatedContent`
- **State Transparency**: Full visibility into queue state, active requests, and per-key health via events and stats

## Installation

```bash
pnpm add @agentskillmania/llm-client
```

## Quick Start

```typescript
import { LLMClient } from '@agentskillmania/llm-client';

const client = new LLMClient();

// Register provider
client.registerProvider({
  name: 'openai',
  maxConcurrency: 10,
});

// Register API key
client.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  maxConcurrency: 5,
  models: [
    { modelId: 'gpt-4o', maxConcurrency: 2 },
    { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 },
  ],
});

// Non-streaming call
const response = await client.call({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.content);
console.log(response.tokens); // { input: 9, output: 12 }
console.log(response.stopReason);
```

## Streaming Usage

```typescript
for await (const event of client.stream({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  priority: 1,
})) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.delta);
      break;
    case 'thinking':
      console.log('Thinking:', event.thinking);
      break;
    case 'tool_call':
      console.log('Tool call:', event.toolCall);
      break;
    case 'done':
      console.log('\nDone!');
      console.log('Total tokens:', event.roundTotalTokens);
      break;
    case 'error':
      console.error('Error:', event.error);
      break;
  }
}
```

## Custom Base URL

Useful for proxies or OpenAI-compatible endpoints (e.g., ZhiPu AI):

```typescript
const client = new LLMClient({
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
});

client.registerProvider({ name: 'openai', maxConcurrency: 10 });
client.registerApiKey({
  key: 'your-api-key',
  provider: 'openai',
  maxConcurrency: 5,
  models: [{ modelId: 'GLM-4', maxConcurrency: 2 }],
});
```

## Priority and Timeouts

```typescript
const response = await client.call({
  model: 'gpt-4o',
  messages: [...],
  priority: 5,              // Higher values are processed first
  requestTimeout: 30000,    // 30s timeout for the actual API call
  totalTimeout: 60000,      // 60s total including queue wait time
  retryOptions: {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    factor: 2,
  },
});
```

## Observability

Listen to scheduler lifecycle events:

```typescript
client.on('state', (event) => {
  console.log(`[${event.requestId}] ${event.type}`);
  // event.type: 'queued' | 'started' | 'retry' | 'completed' | 'failed'
});
```

Get real-time statistics:

```typescript
const stats = client.getStats();
console.log('Queue size:', stats.queueSize);
console.log('Active requests:', stats.activeRequests);
console.log('Key health:', stats.keyHealth); // Map<maskedKey, { success, fail, lastError }>
console.log('Provider active counts:', stats.providerActiveCounts);
console.log('Key active counts:', stats.keyActiveCounts);
```

## Multi-Key Load Balancing

Register multiple keys for the same model. Requests are distributed evenly via round-robin:

```typescript
client.registerApiKey({
  key: 'sk-key1...',
  provider: 'openai',
  maxConcurrency: 3,
  models: [{ modelId: 'gpt-4o', maxConcurrency: 2 }],
});

client.registerApiKey({
  key: 'sk-key2...',
  provider: 'openai',
  maxConcurrency: 5,
  models: [{ modelId: 'gpt-4o', maxConcurrency: 3 }],
});
```

## API Reference

### `LLMClient`

#### Constructor

```typescript
new LLMClient(options?: LLMClientOptions)
```

Options:

- `baseUrl?: string` — Custom API base URL
- `defaultProviderConcurrency?: number` — Default provider limit (default: 10)
- `defaultKeyConcurrency?: number` — Default API key limit (default: 5)
- `defaultModelConcurrency?: number` — Default model limit (default: 3)

#### Methods

- `registerProvider(config: ProviderConfig): void`
- `registerApiKey(config: ApiKeyConfig): void`
- `call(options: CallOptions): Promise<LLMResponse>`
- `stream(options: CallOptions): AsyncIterable<StreamEvent>`
- `getStats(): ClientStats`
- `clear(): void`

### `PiAiAdapter`

Lower-level adapter bridging `@mariozechner/pi-ai` with retry and token tracking:

```typescript
import { PiAiAdapter } from '@agentskillmania/llm-client';

const adapter = new PiAiAdapter({ baseUrl: '...' });
const response = await adapter.complete('gpt-4o', 'sk-...', { messages: [...] });
```

### `RequestScheduler`

Standalone scheduler if you need custom request orchestration:

```typescript
import { RequestScheduler } from '@agentskillmania/llm-client';

const scheduler = new RequestScheduler({
  defaultProviderConcurrency: 10,
  defaultKeyConcurrency: 5,
  defaultModelConcurrency: 3,
});
```

## License

MIT
