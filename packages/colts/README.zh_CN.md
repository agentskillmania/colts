# @agentskillmania/colts

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

具有详细输出、分步执行和状态透明性的 Agent 框架。

## 特性

- **无状态 Runner**：一个 Runner 实例可并发执行多个 AgentState
- **不可变状态**：所有状态更新通过 Immer 完成，原始状态永不修改
- **三级执行控制**：微步（`advance`）、中步（`step`）、宏步（`run`）
- **流式支持**：通过 `*Stream` 方法实现实时 token 输出和阶段观察
- **上下文压缩**：内置截断、滑动窗口、摘要、混合四种策略
- **人机交互**：内置 `ask_human` 工具和 `ConfirmableRegistry`
- **取消支持**：全链路标准 AbortSignal 取消机制
- **工具系统**：基于 Zod 的参数验证，自动生成 JSON Schema
- **Skill 系统**：从 SKILL.md 文件加载领域专用指令，支持目录自动发现
- **Subagent 系统**：将任务委派给具有独立状态和工具的专业子 agent

## 安装

```bash
pnpm add @agentskillmania/colts
```

## 快速开始

```typescript
import { AgentRunner, createAgentState } from '@agentskillmania/colts';

// 创建 Runner（注入模式）
const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: myLLMClient,
  systemPrompt: 'You are a helpful assistant.',
});

// 创建初始状态
let state = createAgentState({
  name: 'my-agent',
  instructions: '你帮助用户进行计算。',
});

// 简单对话
const chatResult = await runner.chat(state, '2+2等于几？');
console.log(chatResult.response); // "4"
state = chatResult.state;

// 运行到完成（自动循环，含工具执行）
const { state: finalState, result } = await runner.run(state);
if (result.type === 'success') {
  console.log('答案:', result.answer);
}
```

## 快速初始化模式

```typescript
const runner = new AgentRunner({
  model: 'gpt-4',
  llm: { apiKey: 'sk-...', provider: 'openai' },
  tools: [calculatorTool],
  maxSteps: 10,
});
```

## 分步执行

```typescript
// 一个完整的 ReAct 循环
const { state: newState, result } = await runner.step(state);
if (result.type === 'done') console.log('答案:', result.answer);
if (result.type === 'continue') console.log('工具结果:', result.toolResult);

// 逐阶段控制
const execState = createExecutionState();
while (true) {
  const { state: s, phase, done } = await runner.advance(state, execState);
  state = s;
  console.log('阶段:', phase.type);
  if (done) break;
}
```

## 流式输出

```typescript
// 实时 token 输出
for await (const event of runner.runStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'complete') console.log('\n完成:', event.result);
}
```

## Skill 系统

Skill 是 agent 可以按需加载的领域专用指令集。

```typescript
import { AgentRunner, FilesystemSkillProvider } from '@agentskillmania/colts';

// 从目录自动发现 Skill
const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: myLLMClient,
  skillDirectories: ['./skills'],
});

// 或注入自定义 Skill 提供者
const skillProvider = new FilesystemSkillProvider(['./skills', '~/.colts/skills']);
const runner2 = new AgentRunner({
  model: 'gpt-4',
  llmClient: myLLMClient,
  skillProvider,
});
```

Skill 从带有 YAML frontmatter 的 `SKILL.md` 文件中发现：

```markdown
---
name: code-review
description: 执行全面的代码审查
---

# 代码审查 Skill

你是一个代码审查专家...
```

配置 skill 提供者后，`load_skill` 工具会自动注册。

## Subagent 系统

将任务委派给具有独立状态和工具集的专业子 agent。

```typescript
import { AgentRunner } from '@agentskillmania/colts';
import type { SubAgentConfig } from '@agentskillmania/colts';

const researcher: SubAgentConfig = {
  name: 'researcher',
  description: '信息研究专家',
  config: {
    name: 'researcher',
    instructions: '你深入研究各种主题。',
    tools: [{ name: 'search', description: '搜索网络', parameters: {} }],
  },
  maxSteps: 5,
};

const writer: SubAgentConfig = {
  name: 'writer',
  description: '内容写作专家',
  config: {
    name: 'writer',
    instructions: '你撰写清晰、引人入胜的内容。',
    tools: [],
  },
};

const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: myLLMClient,
  subAgents: [researcher, writer],
});
```

`delegate` 工具会自动注册，使主 agent 能够将任务委派给子 agent。

## 流式事件

| 事件 | 描述 |
|------|------|
| `phase-change` | 执行阶段转换 |
| `token` | 实时 token 输出 |
| `tool:start` | 工具执行开始 |
| `tool:end` | 工具执行完成 |
| `skill:loading` | Skill 指令加载中 |
| `skill:loaded` | Skill 指令已加载 |
| `subagent:start` | 子 agent 任务开始 |
| `subagent:end` | 子 agent 任务完成 |
| `compressing` | 上下文压缩开始 |
| `compressed` | 上下文压缩完成 |
| `error` | 执行错误 |

## License

MIT
