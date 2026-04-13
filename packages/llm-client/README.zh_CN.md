# @agentskillmania/llm-client

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

统一 LLM 客户端，支持多提供商、三级并发控制、优先级队列、轮询密钥选择和完整的 Token 追踪。

## 特性

- **多提供商支持**：通过 `@mariozechner/pi-ai` 库兼容 OpenAI、Anthropic、Google 等提供商
- **三级并发控制**：Provider → API Key → Model 三级独立限制，防止级联故障
- **优先级队列**：高优先级请求优先处理
- **轮询密钥选择**：同一模型的多个 API Key 自动负载均衡
- **指数退避重试**：针对速率限制（429）、服务端错误（5xx）和网络错误自动重试
- **Token 追踪**：每次请求完整的输入/输出 Token 统计
- **流式支持**：实时逐 token 响应，包含 `delta` 和 `accumulatedContent`
- **状态透明**：通过事件和统计信息完整暴露队列状态、活跃请求和每个 Key 的健康状况

## 安装

```bash
pnpm add @agentskillmania/llm-client
```

## 快速开始

```typescript
import { LLMClient } from '@agentskillmania/llm-client';

const client = new LLMClient();

// 注册提供商
client.registerProvider({
  name: 'openai',
  maxConcurrency: 10,
});

// 注册 API Key
client.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  maxConcurrency: 5,
  models: [
    { modelId: 'gpt-4o', maxConcurrency: 2 },
    { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 },
  ],
});

// 非流式调用
const response = await client.call({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.content);
console.log(response.tokens); // { input: 9, output: 12 }
console.log(response.stopReason);
```

## 流式使用

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

## 自定义 Base URL

适用于代理或 OpenAI 兼容端点（如智谱 AI）：

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

## 优先级与超时

```typescript
const response = await client.call({
  model: 'gpt-4o',
  messages: [...],
  priority: 5,              // 数值越大优先级越高
  requestTimeout: 30000,    // API 调用本身的 30 秒超时
  totalTimeout: 60000,      // 包含队列等待在内的总 60 秒超时
  retryOptions: {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    factor: 2,
  },
});
```

## 可观测性

监听调度器生命周期事件：

```typescript
client.on('state', (event) => {
  console.log(`[${event.requestId}] ${event.type}`);
  // event.type: 'queued' | 'started' | 'retry' | 'completed' | 'failed'
});
```

获取实时统计信息：

```typescript
const stats = client.getStats();
console.log('队列大小:', stats.queueSize);
console.log('活跃请求:', stats.activeRequests);
console.log('Key 健康度:', stats.keyHealth); // Map<脱敏Key, { success, fail, lastError }>
console.log('Provider 活跃数:', stats.providerActiveCounts);
console.log('Key 活跃数:', stats.keyActiveCounts);
```

## 多 Key 负载均衡

为同一模型注册多个 Key，请求会通过轮询 evenly 分配：

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

## API 参考

### `LLMClient`

#### 构造函数

```typescript
new LLMClient(options?: LLMClientOptions)
```

选项：

- `baseUrl?: string` — 自定义 API 基础地址
- `defaultProviderConcurrency?: number` — 默认 Provider 并发限制（默认：10）
- `defaultKeyConcurrency?: number` — 默认 API Key 并发限制（默认：5）
- `defaultModelConcurrency?: number` — 默认模型并发限制（默认：3）

#### 方法

- `registerProvider(config: ProviderConfig): void`
- `registerApiKey(config: ApiKeyConfig): void`
- `call(options: CallOptions): Promise<LLMResponse>`
- `stream(options: CallOptions): AsyncIterable<StreamEvent>`
- `getStats(): ClientStats`
- `clear(): void`

### `PiAiAdapter`

底层适配器，桥接 `@mariozechner/pi-ai` 与重试、Token 追踪逻辑：

```typescript
import { PiAiAdapter } from '@agentskillmania/llm-client';

const adapter = new PiAiAdapter({ baseUrl: '...' });
const response = await adapter.complete('gpt-4o', 'sk-...', { messages: [...] });
```

### `RequestScheduler`

独立的请求调度器，可用于自定义请求编排场景：

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
