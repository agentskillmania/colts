# @agentskillmania/llm-client

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

统一的 LLM 客户端，支持多提供商、并发控制、优先级队列和全面的 Token 统计。

## 特性

- **多提供商支持**：通过 pi-ai 支持 OpenAI、Anthropic、Google 等
- **三级并发控制**：Provider → API Key → Model
- **优先级队列**：高优先级请求优先处理
- **轮询密钥选择**：多个 API Key 间自动负载均衡
- **指数退避重试**：对限流和瞬时错误自动重试
- **Token 统计**：全面的输入/输出 Token 统计
- **流式支持**：实时流式传输，支持内容累积追踪
- **状态透明**：队列状态、活动请求和密钥健康度完全可见

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
  maxConcurrency: 10
});

// 注册 API 密钥
client.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  maxConcurrency: 3,
  models: [
    { modelId: 'gpt-4', maxConcurrency: 2 },
    { modelId: 'gpt-3.5-turbo', maxConcurrency: 5 }
  ]
});

// 非流式调用
const response = await client.call({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.content);
console.log(response.tokens); // { input: 9, output: 12 }
```

## 流式使用

```typescript
for await (const event of client.stream({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  priority: 1 // 更高优先级
})) {
  switch (event.type) {
    case 'text':
      // event.delta: 增量内容
      // event.accumulatedContent: 到目前为止的完整内容
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

## 优先级和超时

```typescript
const response = await client.call({
  model: 'gpt-4',
  messages: [...],
  priority: 5,              // 值越大优先级越高
  requestTimeout: 30000,    // 实际请求超时 30 秒
  totalTimeout: 60000,      // 包含队列等待的总超时 60 秒
  retryOptions: {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000
  }
});
```

## 状态透明

```typescript
// 监听调度器事件
client.on('state', (event) => {
  console.log('Scheduler event:', event);
  // { type: 'queued', requestId, position, estimatedWait }
  // { type: 'started', requestId, key, model }
  // { type: 'retry', requestId, attempt, error }
  // { type: 'completed', requestId, duration, tokens }
});

// 获取当前统计
const stats = client.getStats();
console.log(stats.queueSize);
console.log(stats.activeRequests);
console.log(stats.keyHealth);
```

## 多密钥配置

```typescript
// 注册多个密钥进行负载均衡
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

// 请求自动通过轮询进行负载均衡
```

## 自定义 Base URL

支持 OpenAI 兼容的 API（如智谱 AI）：

```typescript
const client = new LLMClient({
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4'
});

client.registerProvider({ name: 'openai', maxConcurrency: 10 });
client.registerApiKey({
  key: 'your-api-key',
  provider: 'openai',
  maxConcurrency: 5,
  models: [{ modelId: 'GLM-4.7', maxConcurrency: 2 }]
});
```

## License

MIT
