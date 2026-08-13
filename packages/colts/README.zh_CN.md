# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

无状态 ReAct Agent 框架。三级执行控制、事件驱动流式输出、可插拔的上下文工程。一个 Runner 实例可安全服务多个并发 Agent。

## 特色

- **无状态 Runner** — 一个 `AgentRunner` 实例，多个 `AgentState` 实例。天然线程安全。
- **三级执行控制** — `run()`（自动循环）、`step()`（一个 ReAct 周期）、`advance()`（一个阶段）。
- **事件驱动可观测性** — `AgentRunner` 继承 `EventEmitter`。所有执行事件（token、思考、工具调用、阶段变更）均通过 `runner.on(...)` 发出。token 在内部通过 `llmProvider.stream()` 流式拉取后逐个 emit 到 EventEmitter。
- **Thinking / 推理模式** — 原生推理（Claude 风格）和提示词级推理（`<think/>` 标签）。可按请求配置。
- **Skill 系统** — 运行时通过可注入的 `ISkillProvider` 从 `SKILL.md` 加载领域指令（平台无关；Node/浏览器后端走 `SkillFsOps`）。
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
import { LLMClient } from '@agentskillmania/colts/llm';

const runner = new AgentRunner({
  model: 'glm-4',
  llmClient: LLMClient.quickInit({
    providers: [
      {
        name: 'openai',
        apiKey: 'your-api-key',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        models: [{ modelId: 'glm-4' }],
      },
    ],
  }),
  tools: [calculatorTool],
  maxSteps: 10,
});

let state = createAgentState({
  name: 'my-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
});

// 通过 EventEmitter 将 token 流式输出到控制台
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('complete', (e) => console.log('\n完成:', e.result.type));

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

### Run — 自动循环直到获得最终答案或达到 maxSteps

```typescript
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('complete', (e) => console.log('完成:', e.result));

const { state: finalState, result } = await runner.run(state, { maxSteps: 15 });
// result.type: 'success' | 'stopped' | 'max_steps' | 'error' | 'abort' | 'waiting-human'
```

### Step — 执行一个 ReAct 周期

```typescript
const { state: newState, result } = await runner.step(state);
// result.type: 'done' | 'continue' | 'error'

runner.on('phase-change', (e) => console.log('阶段:', e.to.type));
```

### Advance — 细粒度按阶段控制

```typescript
import { createExecutionState, isTerminalPhase } from '@agentskillmania/colts';

let execState = createExecutionState();
while (!isTerminalPhase(execState.phase)) {
  const result = await runner.advance(state, execState);
  state = result.state;
  execState = result.execState;   // ExecutionState 不可变——取更新后的实例
}
```

## 事件系统

`AgentRunner` 继承 `EventEmitter`（来自 `eventemitter3`）。所有执行事件都走单一通道，不存在独立的流式 API。通过 `runner.on(event, handler)` 订阅：

```typescript
runner.on('run:start', (e) => console.log('Run 开始'));
runner.on('step:start', (e) => console.log(`Step ${e.step}`));
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('thinking', (e) => process.stderr.write(e.content));
runner.on('tool:start', (e) => console.log('工具:', e.action.tool));
runner.on('tool:end', (e) => console.log('工具结果:', e.result));
runner.on('phase-change', (e) => console.log(`${e.from.type} → ${e.to.type}`));
runner.on('compressing', () => console.log('压缩上下文中...'));
runner.on('complete', (e) => console.log('Run 结果:', e.result.type));
runner.on('error', (e) => console.error('错误:', e.error));
```

主要事件分组：生命周期（`run:start`、`run:end`、`step:start`、`step:end`、`complete`）、token 流（`token`、`thinking`）、工具（`tool:start`、`tool:end`、`tools:start`、`tools:end`）、上下文压缩（`compressing`、`compressed`）、LLM 调用（`llm:request`、`llm:response`）、技能（`skill:start`、`skill:end`）。

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

Skill 是从 `SKILL.md` 文件加载的领域专属指令集。Runner 接受可注入的 `ISkillProvider`——技能存哪、怎么读由宿主决定。

### 注入 provider（推荐）

```typescript
import { AgentRunner, FilesystemSkillProvider, setDefaultSkillFsOps } from '@agentskillmania/colts';
import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops';   // Node 后端（按需子路径）

// Node：启动时注册一次默认 SkillFsOps，然后构造 provider
setDefaultSkillFsOps(nodeFsOps);
const skillProvider = new FilesystemSkillProvider(['./skills']);

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  skillProvider,   // 注入——任意后端均可
});
```

`FilesystemSkillProvider` 本身不导入任何 `node:` 模块——它通过 `SkillFsOps` 抽象读写：

- **Node**：启动时 `setDefaultSkillFsOps(nodeFsOps)`（来自 `node-fs-ops` 子路径），然后 `new FilesystemSkillProvider(dirs)` 即可
- **浏览器等宿主**：基于自己的存储（如 OPFS）实现 `SkillFsOps` 并传给构造器——本模块可运行在任何环境

### `skillDirs` 便捷路径（仅 Node）

`skillDirs` 会在内部用全局注册的默认 `SkillFsOps` 构造 `FilesystemSkillProvider`——Node 下方便，但不可移植：未注册默认值的宿主上会抛错。

```typescript
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  skillDirs: ['./skills'],
});
```

### `SKILL.md` 格式

```markdown
---
name: code-review
description: Perform comprehensive code reviews
---

# Code Review Skill

You are a code review expert...
```

存在技能 provider 时 Runner 会自动注册 `load_skill` 工具，支持运行时切换 Skill。

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

## 子代理委托

子代理委托（`delegate` 工具 + `SubAgentConfig[]`、`subagent:*` 事件）由 **wrangler** 在 colts 之上提供 —— 见 wrangler README。

## 状态管理

`AgentState` 是纯数据 — 可序列化、不可变、可克隆。

```typescript
import { createAgentState, addUserMessage, serializeState } from '@agentskillmania/colts';

let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, 'Hello');

const json = serializeState(state);
```

## License

MIT
