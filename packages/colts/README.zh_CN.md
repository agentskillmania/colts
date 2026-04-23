# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

无状态 ReAct Agent 框架。流式优先的 API 设计、三级执行控制、可插拔的上下文工程。一个 Runner 实例可安全服务多个并发 Agent。

## 特色

- **无状态 Runner** — 一个 `AgentRunner` 实例，多个 `AgentState` 实例。天然线程安全。
- **三级执行控制** — `run()`（自动循环）、`step()`（一个 ReAct 周期）、`advance()`（一个阶段）。均提供流式变体。
- **流式优先** — 每个执行 API 都有 `AsyncIterable` 对应版本：`runStream`、`stepStream`、`advanceStream`、`chatStream`。
- **Thinking / 推理模式** — 原生推理（Claude 风格）和提示词级推理（`<think/>` 标签）。可按请求配置。
- **Skill 系统** — 运行时从 `SKILL.md` 文件动态加载领域指令。支持 `load_skill` / `return_skill` 嵌套调用。
- **Subagent 委托** — 将任务委托给具有独立配置、工具和状态的专用子代理。
- **上下文压缩** — 两种策略（`truncate`、`summarize`）。消息永不删除。
- **可插拔消息组装** — `IMessageAssembler` 接口，支持自定义 RAG、记忆或提示词策略，无需 fork Runner。
- **工具系统** — 基于 Zod 的参数校验，自动生成 JSON Schema。

## 安装

```bash
pnpm add @agentskillmania/colts
```

## 快速开始

```typescript
import { AgentRunner, createAgentState, calculatorTool } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'glm-4',
  llm: {
    apiKey: 'your-api-key',
    provider: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },
  tools: [calculatorTool],
  maxSteps: 10,
});

let state = createAgentState({
  name: 'my-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
});

// 自动循环直到获得最终答案或达到 maxSteps
const { result } = await runner.run(state);
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

生产环境推荐注入预配置的依赖：

```typescript
import { AgentRunner, ToolRegistry } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/llm-client';

const llmClient = new LLMClient({
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
});
llmClient.registerProvider({ name: 'openai', maxConcurrency: 10 });
llmClient.registerApiKey({
  key: 'your-api-key',
  provider: 'openai',
  models: [{ modelId: 'glm-4' }],
});

const runner = new AgentRunner({
  model: 'glm-4',
  llmClient,
  systemPrompt: 'You are a helpful assistant.',
});
```

## 核心 API

### Chat — 单轮对话，不执行工具

```typescript
const { state: newState, response } = await runner.chat(state, '你好！');

// 流式
for await (const chunk of runner.chatStream(state, '你好！')) {
  if (chunk.type === 'text') process.stdout.write(chunk.delta);
}
```

### Run — 自动循环直到获得最终答案或达到 maxSteps

```typescript
const { state: finalState, result } = await runner.run(state, { maxSteps: 15 });
// result.type: 'success' | 'max_steps' | 'error'

// 流式
for await (const event of runner.runStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'complete') console.log('完成:', event.result);
}
```

### Step — 执行一个 ReAct 周期

```typescript
const { state: newState, result } = await runner.step(state);
// result.type: 'done' | 'continue' | 'error'

for await (const event of runner.stepStream(state)) {
  if (event.type === 'phase-change') console.log('阶段:', event.to.type);
}
```

### Advance — 细粒度按阶段控制

```typescript
import { createExecutionState, isTerminalPhase } from '@agentskillmania/colts';

const execState = createExecutionState();
while (!isTerminalPhase(execState.phase)) {
  const result = await runner.advance(state, execState);
  state = result.state;
}
```

## 工具系统

```typescript
import { z } from 'zod';
import { ToolRegistry } from '@agentskillmania/colts';

const registry = new ToolRegistry();
registry.register({
  name: 'search',
  description: 'Search the web',
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => `Results for: ${query}`,
});
```

内置工具：`calculatorTool`、`createAskHumanTool(handler)`。

使用 `ConfirmableRegistry` 可对危险工具要求人工确认。

## Thinking / 推理模式

两种推理模式：

**原生推理** — 适用于内置推理能力的模型（如 Claude）：

```typescript
const runner = new AgentRunner({
  model: 'claude-sonnet-4-5-20250514',
  llmClient,
  thinkingEnabled: true,
});
```

**提示词级推理** — 注入"think step by step"引导，并从响应中提取 `<think/>` 标签：

```typescript
const runner = new AgentRunner({
  model: 'glm-4',
  llmClient,
  enablePromptThinking: true,
});
```

## Skill 系统

Skill 是从 `SKILL.md` 文件加载的领域专属指令集：

```typescript
const runner = new AgentRunner({
  model: 'glm-4',
  llmClient,
  skillDirectories: ['./skills', '~/.agentskillmania/colts/skills'],
});
```

`SKILL.md` 格式：

```markdown
---
name: code-review
description: Perform comprehensive code reviews
---

# Code Review Skill

You are a code review expert...
```

Runner 会自动注册 `load_skill` 和 `return_skill` 工具，支持运行时切换 Skill 和嵌套 Skill 调用。

## 上下文压缩

防止上下文无限增长。**消息永远不会被删除**，压缩仅影响发送给 LLM 的内容。

```typescript
const runner = new AgentRunner({
  model: 'glm-4',
  llmClient,
  compressor: {
    strategy: 'truncate',
    threshold: 50,
    thresholdType: 'message-count',
    keepRecent: 10,
  },
});
```

策略：`truncate`、`summarize`。其中 `summarize` 会调用 LLM 生成摘要，也可通过 `summaryModel` 或 `summaryProvider` 指定专用模型负责摘要。

## Subagent 系统

```typescript
const runner = new AgentRunner({
  model: 'glm-4',
  llmClient,
  subAgents: [{
    name: 'researcher',
    description: 'Research specialist',
    config: { name: 'researcher', instructions: 'Research topics thoroughly.', tools: [] },
    maxSteps: 5,
  }],
});
```

`delegate` 工具会自动注册，使父代理能够调用子代理。

## 状态管理

`AgentState` 是纯数据 — 可序列化、不可变、可克隆。

```typescript
import {
  createAgentState,
  addUserMessage,
  createSnapshot,
  serializeState,
} from '@agentskillmania/colts';

let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, 'Hello');

const snapshot = createSnapshot(state);
const json = serializeState(state);
```

## License

MIT
