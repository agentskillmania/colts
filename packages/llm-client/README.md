# @agentskillmania/llm-client

A unified LLM client with multi-provider support, concurrency control, priority queuing, and comprehensive token tracking.

## Features

- **Multi-provider support**: Works with OpenAI, Anthropic, Google, and more via pi-ai
- **Three-level concurrency control**: Provider → API Key → Model
- **Priority queue**: Higher priority requests are processed first
- **Round-robin key selection**: Automatic load balancing across multiple API keys
- **Retry with exponential backoff**: Automatic retry on rate limits and transient errors
- **Token tracking**: Comprehensive input/output token statistics
- **Streaming support**: Real-time streaming with accumulated content tracking
- **State transparency**: Full visibility into queue state, active requests, and key health

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
  maxConcurrency: 10
});

// Register API key
client.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  maxConcurrency: 3,
  models: [
    { modelId: 'gpt-4', maxConcurrency: 2 },
    { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 }
  ]
});

// Non-streaming call
const response = await client.call({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.content);
console.log(response.tokens); // { input: 9, output: 12 }
```

## Streaming Usage

```typescript
for await (const event of client.stream({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  priority: 1 // Higher priority
})) {
  switch (event.type) {
    case 'text':
      // event.delta: incremental content
      // event.accumulatedContent: full content so far
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

## Priority and Timeouts

```typescript
const response = await client.call({
  model: 'gpt-4',
  messages: [...],
  priority: 5,              // Higher values processed first
  requestTimeout: 30000,    // 30s timeout for the actual request
  totalTimeout: 60000,      // 60s total including queue wait
  retryOptions: {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000
  }
});
```

## State Transparency

```typescript
// Listen to scheduler events
client.on('state', (event) => {
  console.log('Scheduler event:', event);
  // { type: 'queued', requestId, position, estimatedWait }
  // { type: 'started', requestId, key, model }
  // { type: 'retry', requestId, attempt, error }
  // { type: 'completed', requestId, duration, tokens }
});

// Get current stats
const stats = client.getStats();
console.log(stats.queueSize);
console.log(stats.activeRequests);
console.log(stats.keyHealth);
```

## Multi-Key Configuration

```typescript
// Register multiple keys for load balancing
client.registerApiKey({
  key: 'sk-key1...',
  provider: 'openai',
  maxConcurrency: 3,
  models: [{ modelId: 'gpt-4', maxConcurrency: 2 }]
});

client.registerApiKey({
  key: 'sk-key2...',
  provider: 'openai',
  maxConcurrency: 5,
  models: [{ modelId: 'gpt-4', maxConcurrency: 3 }]
});

// Requests are automatically load balanced via round-robin
```

## License

MIT
