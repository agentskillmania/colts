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

## License

MIT
