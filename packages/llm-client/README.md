# @agentskillmania/llm-client

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

A unified LLM client with three-level concurrency control, multi-key load balancing, priority queuing, and built-in retry. Works with OpenAI, Anthropic, Google, and any OpenAI-compatible endpoint out of the box.

## Highlights

- **Three-Level Concurrency Control** — Independent limits at Provider → API Key → Model to prevent cascading failures
- **Multi-Key Load Balancing** — Round-robin across multiple API keys for the same model
- **Priority Queue** — Higher-priority requests are processed first
- **Auto Retry** — Exponential backoff on rate limits (429), server errors (5xx), and network failures
- **Streaming** — Real-time token-by-token responses with `delta` and accumulated content
- **Thinking / Reasoning** — Native thinking support for reasoning-capable models (e.g. Claude)
- **Token Tracking** — Complete input/output token statistics per request
- **Observability** — Queue state, active requests, per-key health via events and `getStats()`

## Supported Providers

Any provider accessible via the `@mariozechner/pi-ai` library, including:

- **OpenAI** — `gpt-4o`, `gpt-4`, `gpt-3.5-turbo`, etc.
- **Anthropic** — `claude-sonnet-4-5-20250514`, `claude-opus-4-20250514`, etc.
- **Google** — `gemini-pro`, etc.
- **OpenAI-compatible endpoints** — ZhiPu AI, DeepSeek, Ollama, vLLM, etc. via `baseUrl`

## Installation

```bash
pnpm add @agentskillmania/llm-client
```

## Quick Start

```typescript
import { LLMClient } from '@agentskillmania/llm-client';

const client = new LLMClient();

client.registerProvider({ name: 'openai', maxConcurrency: 10 });
client.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  models: [{ modelId: 'gpt-4o', maxConcurrency: 2 }],
});

const response = await client.call({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.content);    // "Hello! How can I help you?"
console.log(response.tokens);     // { input: 9, output: 8 }
console.log(response.stopReason); // "stop"
```

## Streaming

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
      console.log('\nTokens:', event.roundTotalTokens);
      break;
  }
}
```

## Thinking / Reasoning

Enable thinking output for reasoning-capable models:

```typescript
const response = await client.call({
  model: 'claude-sonnet-4-5-20250514',
  messages: [{ role: 'user', content: 'Solve this step by step: ...' }],
  thinkingEnabled: true,
});

console.log(response.thinking); // The model's reasoning process
console.log(response.content);  // The final answer

// Streaming
for await (const event of client.stream({
  model: 'claude-sonnet-4-5-20250514',
  messages: [...],
  thinkingEnabled: true,
})) {
  if (event.type === 'thinking') {
    console.log('Reasoning:', event.thinking);
  }
}
```

## Custom Base URL

For OpenAI-compatible endpoints (ZhiPu AI, DeepSeek, Ollama, etc.):

```typescript
const client = new LLMClient({
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
});

client.registerProvider({ name: 'openai', maxConcurrency: 10 });
client.registerApiKey({
  key: 'your-api-key',
  provider: 'openai',
  models: [{ modelId: 'glm-4', maxConcurrency: 2 }],
});
```

## Multi-Key Load Balancing

Register multiple keys for the same model. Requests are distributed via round-robin:

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

## Priority and Timeouts

```typescript
const response = await client.call({
  model: 'gpt-4o',
  messages: [...],
  priority: 5,              // Higher values first
  requestTimeout: 30000,    // API call timeout
  totalTimeout: 60000,      // Total including queue wait
  retryOptions: {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    factor: 2,
  },
});
```

## Observability

```typescript
// Lifecycle events
client.on('state', (event) => {
  console.log(`[${event.requestId}] ${event.type}`);
  // 'queued' | 'started' | 'retry' | 'completed' | 'failed'
});

// Real-time stats
const stats = client.getStats();
console.log('Queue:', stats.queueSize);
console.log('Active:', stats.activeRequests);
console.log('Key health:', stats.keyHealth);
```

## API Reference

### `LLMClient`

```typescript
new LLMClient(options?: { baseUrl?, defaultProviderConcurrency?, defaultKeyConcurrency?, defaultModelConcurrency? })
```

Methods:
- `registerProvider(config)` — Register a provider with concurrency limits
- `registerApiKey(config)` — Register an API key with model-level concurrency limits
- `call(options): Promise<LLMResponse>` — Non-streaming completion
- `stream(options): AsyncIterable<StreamEvent>` — Streaming completion
- `getStats(): ClientStats` — Real-time queue and health statistics
- `clear(): void` — Reset all state

## License

MIT
