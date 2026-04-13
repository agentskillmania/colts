# @agentskillmania/colts

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

核心 ReAct Agent 框架，专为开发与调试设计。提供无状态 Runner、不可变状态更新、三级执行控制、流式输出、上下文压缩、Skill 系统和 Subagent 委托功能。

## 特性

- **无状态 Runner**：单个 `AgentRunner` 可安全并发执行多个 `AgentState` 实例
- **不可变状态**：所有状态更新均通过 Immer 完成，原始状态永不修改
- **三级执行控制**：
  - 微步：`advance()` / `advanceStream()` — 每次推进一个执行阶段
  - 中步：`step()` / `stepStream()` — 完成一个完整 ReAct 周期
  - 宏步：`run()` / `runStream()` — 自动循环直到完成或达到 `maxSteps`
- **流式支持**：实时输出 token、阶段转换、工具调用和压缩事件
- **上下文压缩**：内置 `DefaultContextCompressor`，支持 `truncate`、`sliding-window`、`summarize`、`hybrid` 策略
- **人在回路**：内置 `ask_human` 工具和 `ConfirmableRegistry`
- **工具系统**：基于 Zod 的参数校验，通过 `zodToJsonSchema` 自动生成 JSON Schema
- **Skill 系统**：自动发现并加载 `SKILL.md` 文件中的领域指令，支持嵌套 Skill 调用
- **Subagent 系统**：将任务委托给具有独立配置、工具和状态的专用子代理

## 安装

```bash
pnpm add @agentskillmania/colts
```

## 快速开始

### 注入模式（推荐用于生产）

```typescript
import { AgentRunner, createAgentState, ToolRegistry } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/llm-client';

const llmClient = new LLMClient();
llmClient.registerProvider({ name: 'openai', maxConcurrency: 10 });
llmClient.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  maxConcurrency: 5,
  models: [{ modelId: 'gpt-4o', maxConcurrency: 2 }],
});

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  systemPrompt: 'You are a helpful assistant.',
});

let state = createAgentState({
  name: 'my-agent',
  instructions: 'You help users with calculations.',
  tools: [],
});

// 简单对话（单轮）
const chatResult = await runner.chat(state, 'What is 2+2?');
console.log(chatResult.response); // "4"
console.log(chatResult.tokens);   // { input: 15, output: 2 }
state = chatResult.state;

// 自动运行直到完成（支持工具自动调用）
const { state: finalState, result } = await runner.run(state);
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

### 快速初始化模式（原型开发更方便）

```typescript
import { AgentRunner, createAgentState, calculatorTool } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'gpt-4o',
  llm: { apiKey: 'sk-...', provider: 'openai' },
  tools: [calculatorTool],
  maxSteps: 10,
});
```

## 执行 API

### Chat

单轮对话，不执行工具。

```typescript
const result = await runner.chat(state, 'Hello!', { priority: 0 });
// result: { state, response, tokens, stopReason }

for await (const chunk of runner.chatStream(state, 'Hello!')) {
  if (chunk.type === 'text') process.stdout.write(chunk.delta);
  if (chunk.type === 'done') console.log('\nTokens:', chunk.tokens);
}
```

### Run

自动循环调用 `step()`，直到获得最终答案或达到 `maxSteps`。

```typescript
const { state: finalState, result } = await runner.run(state, { maxSteps: 15 });
// result.type: 'success' | 'max_steps' | 'error'

for await (const event of runner.runStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'complete') console.log('\nDone:', event.result);
}
```

### Step

精确执行一个 ReAct 周期（preparing → calling-llm → parsing → [executing-tool] → completed）。

```typescript
const { state: newState, result } = await runner.step(state);
// result.type: 'done' | 'continue' | 'error'

for await (const event of runner.stepStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'phase-change') console.log('Phase:', event.to.type);
}
```

### Advance

细粒度的按阶段执行。由调用方外部管理 `ExecutionState`。

```typescript
import { createExecutionState, isTerminalPhase } from '@agentskillmania/colts';

const execState = createExecutionState();
while (!isTerminalPhase(execState.phase)) {
  const { state: newState, phase, done } = await runner.advance(state, execState);
  state = newState;
  console.log('Phase:', phase.type);
  if (phase.type === 'parsed' && phase.action) {
    console.log('Action:', phase.action);
  }
}

// 流式变体
for await (const event of runner.advanceStream(state, execState)) {
  if (event.type === 'token') process.stdout.write(event.token);
}
```

## 状态管理

`AgentState` 是纯数据 — 可序列化、不可变、可克隆。

```typescript
import {
  createAgentState,
  addUserMessage,
  addAssistantMessage,
  incrementStepCount,
  createSnapshot,
  restoreSnapshot,
  serializeState,
  deserializeState,
} from '@agentskillmania/colts';

let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, 'Hello');
state = addAssistantMessage(state, 'Hi there!', { type: 'final', visible: true });
state = incrementStepCount(state);

// 快照
const snapshot = createSnapshot(state);
const restored = restoreSnapshot(snapshot);

// 序列化
const json = serializeState(state);
state = deserializeState(json);
```

## 工具系统

使用 Zod Schema 注册工具，Runner 会自动为 LLM 生成 JSON Schema。

```typescript
import { z } from 'zod';
import { ToolRegistry } from '@agentskillmania/colts';

const registry = new ToolRegistry();
registry.register({
  name: 'calculate',
  description: 'Evaluate a math expression',
  parameters: z.object({ expression: z.string() }),
  execute: async ({ expression }) => eval(expression).toString(),
});

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  toolRegistry: registry,
});
```

内置工具：

- `calculatorTool` — 基础数学计算器
- `createAskHumanTool(handler)` — 暂停执行并向人类提问

## 上下文压缩

通过 `DefaultContextCompressor` 防止上下文无限增长。**消息永远不会被删除**，压缩仅影响发送给 LLM 的内容。

```typescript
import { DefaultContextCompressor } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  compressor: {
    strategy: 'hybrid',
    threshold: 50,
    thresholdType: 'message-count',
    keepRecent: 10,
  },
});
```

策略说明：

- `truncate` / `sliding-window` — 丢弃旧消息
- `summarize` / `hybrid` — 调用 LLM 对旧消息进行摘要（需要提供 `llmClient`）

## Skill 系统

Skill 是从 `SKILL.md` 文件加载的领域专属指令集。

```typescript
import { FilesystemSkillProvider } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'gpt-4o',
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

配置 Skill Provider 后，Runner 会自动注册以下工具：
- `load_skill` — 切换到指定 Skill
- `return_skill` — 从嵌套 Skill 调用返回

## Subagent 系统

将任务委托给独立的子代理。

```typescript
import type { SubAgentConfig } from '@agentskillmania/colts';

const researcher: SubAgentConfig = {
  name: 'researcher',
  description: 'Research specialist',
  config: {
    name: 'researcher',
    instructions: 'Research topics thoroughly.',
    tools: [],
  },
  maxSteps: 5,
  allowDelegation: false,
};

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  subAgents: [researcher],
});
```

`delegate` 工具会自动注册，使父代理能够调用子代理。

## Runner 事件

`AgentRunner` 继承自 `EventEmitter`，可监听以下事件：

| 事件 | 负载 | 描述 |
|-------|---------|-------------|
| `run:start` | `{ state }` | `run()` / `runStream()` 开始 |
| `run:end` | `{ state, result }` | Run 完成 |
| `step:start` | `{ state, stepNumber }` | `step()` / `stepStream()` 开始 |
| `step:end` | `{ state, stepNumber, result }` | Step 完成 |
| `advance:phase` | `{ from, to, state }` | `advance()` 阶段变化 |
| `llm:tokens` | `{ tokens: string[] }` | LLM 返回的 token 批次 |
| `tool:call` | `{ tool, arguments }` | 工具执行开始 |
| `tool:result` | `{ tool, result }` | 工具执行完成 |
| `skill:load` | `{ name }` | Skill 加载 |
| `compress:start` | `{ state }` | 压缩开始 |
| `compress:end` | `{ state, summary, removedCount }` | 压缩完成 |
| `error` | `{ state, error, phase }` | 执行出错 |

## 流式事件

`*Stream` 方法产生的事件：

| 事件 | 字段 | 描述 |
|-------|--------|-------------|
| `phase-change` | `from`, `to` | 执行阶段转换 |
| `token` | `token` | 实时 token 输出 |
| `tool:start` | `action` | 工具执行开始 |
| `tool:end` | `result` | 工具执行完成 |
| `skill:loading` | `name` | Skill 指令加载中 |
| `skill:loaded` | `name`, `tokenCount` | Skill 指令加载完成 |
| `skill:start` | `name`, `task` | Skill 任务开始 |
| `skill:end` | `name`, `result` | Skill 任务结束 |
| `subagent:start` | `name`, `task` | 子代理任务开始 |
| `subagent:end` | `name`, `result` | 子代理任务结束 |
| `compressing` | — | 上下文压缩开始 |
| `compressed` | `summary`, `removedCount` | 上下文压缩完成 |
| `error` | `error`, `context` | 执行错误 |
| `step:start` | `step`, `state` | Step 开始（仅 runStream） |
| `step:end` | `step`, `result` | Step 结束（仅 runStream） |
| `complete` | `result` | Run 完成（仅 runStream） |

## License

MIT
