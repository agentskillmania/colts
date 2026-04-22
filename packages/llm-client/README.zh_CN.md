# @agentskillmania/llm-client

[![npm version](https://img.shields.io/npm/v/@agentskillmania/llm-client.svg)](https://www.npmjs.com/package/@agentskillmania/llm-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

统一 LLM 客户端。三级并发控制、多 Key 负载均衡、优先级队列、内置重试。开箱即用支持 OpenAI、Anthropic、Google 及所有 OpenAI 兼容端点。

## 特色

- **三级并发控制** — Provider → API Key → Model 三级独立限制，防止级联故障
- **多 Key 负载均衡** — 同一模型的多个 API Key 轮询分配
- **优先级队列** — 高优先级请求优先处理
- **自动重试** — 针对速率限制（429）、服务端错误（5xx）和网络错误指数退避重试
- **流式输出** — 实时逐 token 响应，包含 `delta` 和累积内容
- **Thinking / 推理** — 原生推理支持，适用于推理能力模型（如 Claude）
- **Token 追踪** — 每次请求完整的输入/输出 Token 统计
- **可观测性** — 通过事件和 `getStats()` 完整暴露队列状态、活跃请求和 Key 健康状况

## 支持的提供商

通过 `@mariozechner/pi-ai` 库支持所有主流提供商：

- **OpenAI** — `gpt-4o`、`gpt-4`、`gpt-3.5-turbo` 等
- **Anthropic** — `claude-sonnet-4-5-20250514`、`claude-opus-4-20250514` 等
- **Google** — `gemini-pro` 等
- **OpenAI 兼容端点** — 智谱 AI、DeepSeek、Ollama、vLLM 等，通过 `baseUrl` 配置

## 安装

```bash
pnpm add @agentskillmania/llm-client
```

## 快速开始

```typescript
import { LLMClient } from '@agentskillmania/llm-client';

const client = new LLMClient({
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
});

client.registerProvider({ name: 'openai', maxConcurrency: 10 });
client.registerApiKey({
  key: 'your-api-key',
  provider: 'openai',
  models: [{ modelId: 'glm-4', maxConcurrency: 2 }],
});

const response = await client.call({
  model: 'glm-4',
  messages: [{ role: 'user', content: '你好！' }],
});

console.log(response.content);    // "你好！有什么可以帮你的？"
console.log(response.tokens);     // { input: 9, output: 8 }
console.log(response.stopReason); // "stop"
```

## 流式输出

```typescript
for await (const event of client.stream({
  model: 'glm-4',
  messages: [{ role: 'user', content: '讲个故事' }],
  priority: 1,
})) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.delta);
      break;
    case 'thinking':
      console.log('推理中:', event.thinking);
      break;
    case 'tool_call':
      console.log('工具调用:', event.toolCall);
      break;
    case 'done':
      console.log('\nToken 数:', event.roundTotalTokens);
      break;
  }
}
```

## Thinking / 推理模式

对支持推理的模型启用思考过程输出：

```typescript
const response = await client.call({
  model: 'claude-sonnet-4-5-20250514',
  messages: [{ role: 'user', content: '请一步步解决这个问题：...' }],
  thinkingEnabled: true,
});

console.log(response.thinking); // 模型的推理过程
console.log(response.content);  // 最终答案

// 流式
for await (const event of client.stream({
  model: 'claude-sonnet-4-5-20250514',
  messages: [...],
  thinkingEnabled: true,
})) {
  if (event.type === 'thinking') {
    console.log('推理:', event.thinking);
  }
}
```

## 自定义 Base URL

适用于 OpenAI 兼容端点（智谱 AI、DeepSeek、Ollama 等）：

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

## 多 Key 负载均衡

为同一模型注册多个 Key，请求通过轮询分配：

```typescript
client.registerApiKey({
  key: 'sk-key1...',
  provider: 'openai',
  maxConcurrency: 3,
  models: [{ modelId: 'glm-4', maxConcurrency: 2 }],
});

client.registerApiKey({
  key: 'sk-key2...',
  provider: 'openai',
  maxConcurrency: 5,
  models: [{ modelId: 'glm-4', maxConcurrency: 3 }],
});
```

## 优先级与超时

```typescript
const response = await client.call({
  model: 'glm-4',
  messages: [...],
  priority: 5,              // 数值越大优先级越高
  requestTimeout: 30000,    // API 调用超时
  totalTimeout: 60000,      // 包含队列等待的总超时
  retryOptions: {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 10000,
    factor: 2,
  },
});
```

## 可观测性

```typescript
// 生命周期事件
client.on('state', (event) => {
  console.log(`[${event.requestId}] ${event.type}`);
  // 'queued' | 'started' | 'retry' | 'completed' | 'failed'
});

// 实时统计
const stats = client.getStats();
console.log('队列大小:', stats.queueSize);
console.log('活跃请求:', stats.activeRequests);
console.log('Key 健康度:', stats.keyHealth);
```

## API 参考

### `LLMClient`

```typescript
new LLMClient(options?: { baseUrl?, defaultProviderConcurrency?, defaultKeyConcurrency?, defaultModelConcurrency? })
```

方法：
- `registerProvider(config)` — 注册提供商并设置并发限制
- `registerApiKey(config)` — 注册 API Key 并设置模型级并发限制
- `call(options): Promise<LLMResponse>` — 非流式补全
- `stream(options): AsyncIterable<StreamEvent>` — 流式补全
- `getStats(): ClientStats` — 实时队列和健康统计
- `clear(): void` — 重置所有状态

## License

MIT
