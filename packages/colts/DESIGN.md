# colts 设计文档

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./DESIGN.zh_CN.md)

> 面向开发调试的 ReAct Agent 框架

## 核心架构

### 分离原则：状态 vs 运行

```typescript
// AgentState = 纯数据（可序列化，无逻辑，不可变）
interface AgentState {
  id: string;
  config: AgentConfig;      // 人设、工具列表
  context: {
    messages: Message[];    // 对话历史
    stepCount: number;      // 执行步数
  };
}

// AgentRunner = 纯逻辑（无状态，可复用）
class AgentRunner {
  constructor(config: RunnerConfig);
  
  // 推进指定 AgentState 一步，返回新状态（不可变）
  async step(state: AgentState): Promise<{
    state: AgentState;      // 新状态（使用 Immer 创建）
    result: StepResult;
  }>;
  
  // 运行指定 AgentState 到结束，返回最终状态（不可变）
  async run(state: AgentState, options?: RunOptions): Promise<{
    state: AgentState;      // 最终状态
    result: RunResult;
  }>;
}
```

**关键特性**：
- 一个 Runner 实例可同时运行多个 AgentState
- AgentState 是**不可变数据**（使用 [Immer](https://immerjs.github.io/immer/)）
- 每次 `step()` / `run()` 返回**新状态**，原状态保持不变
- 快照免费（O(1) 引用保存），天然支持时间旅行
- Runner 配置（LLM、钩子）与 Agent 状态解耦

### 不可变数据与流式

```typescript
// 流式不修改状态，只是观察
for await (const event of runner.stepStream(state)) {
  // event 包含实时 token，但 state 始终是最初的引用
  console.log(event.token);  // 实时显示
}

// 流结束后，获取新状态
const { state: newState, result } = await streamResult;
// state 还是原来的，newState 是更新后的
```

---

## Step 定义

### 什么是 "一次 Step"？

一次 Step = **一次完整的 ReAct 循环**：

1. 调用 LLM（带上当前对话历史）
2. 解析 LLM 响应，提取 Thought 和 Action
3. 如果有 Action，执行对应工具
4. 更新 AgentState（messages、stepCount）
5. 返回结果类型（继续 或 完成）

### 什么时候 "Run 结束"？

满足任一条件即结束：
- ✅ **正常结束**：LLM 直接给出最终答案（无 Action）
- ❌ **步数耗尽**：达到 `maxSteps` 限制（默认 10，防死循环）
- ❌ **执行错误**：LLM 调用失败或工具执行异常
- ❌ **用户中止**：外部调用中断

---

## 开发路线图

### Phase 1: 核心引擎（可运行的 Agent）

#### Step 0: AgentState 数据结构
**目标**: 定义纯状态结构，可序列化，不可变

```typescript
import { produce, Draft } from 'immer';

// AgentState 是纯数据，无方法
interface AgentState {
  id: string;
  config: {
    name: string;
    instructions: string;
    tools: ToolDefinition[];
  };
  context: {
    messages: Message[];
    stepCount: number;
  };
}
```

**验收标准**:
- [ ] 能创建初始状态
- [ ] 能 `JSON.stringify` 序列化
- [ ] 能 `JSON.parse` 反序列化并恢复
- [ ] 使用 Immer 进行不可变更新
- [ ] 更新后原状态保持不变（`oldState !== newState`）
- [ ] 包含对话历史数组

---

#### Step 1: 基础 LLM 对话
**目标**: 让 Agent 能说话（不解析，只对话）

```typescript
class AgentRunner {
  async chat(state: AgentState, userInput: string): Promise<string>;
}
```

**验收标准**:
- [ ] 输入 "Hello"，能返回 LLM 的回复
- [ ] 多次对话能看到历史上下文
- [ ] stepCount 始终为 0（还没开始 ReAct）

---

#### Step 2: Response 解析器
**目标**: 从 LLM 回复中提取 Thought 和 Action

```typescript
function parseReActResponse(content: string): {
  thought: string;
  action: { tool: string; args: object } | null;
  isFinalAnswer: boolean;
}
```

**支持格式**（可配置）：
- ReAct 经典格式：`Thought: ... Action: ...`
- XML 格式：`<thought>...</thought> <action>...</action>`

**验收标准**:
- [ ] 能解析带 Action 的回复
- [ ] 能解析纯文本回答（isFinalAnswer=true）
- [ ] 解析失败时抛出明确错误

---

#### Step 3: 工具系统基础
**目标**: 能定义和执行工具

```typescript
interface Tool {
  name: string;
  execute(args: object): Promise<unknown>;
}

class ToolRegistry {
  register(tool: Tool): void;
  execute(name: string, args: object): Promise<unknown>;
}
```

**验收标准**:
- [ ] 能注册一个 calculator 工具
- [ ] 能执行工具并返回结果
- [ ] 工具不存在时抛错

---

#### Step 4: 单步推进（Step）
**目标**: 完成一次 ReAct 循环

```typescript
// 流式事件类型
type StreamEvent =
  | { type: 'token'; token: string }                    // LLM 实时 token
  | { type: 'thought'; text: string }                   // 解析出的思考
  | { type: 'action'; tool: string; args: object }      // 检测到的 Action
  | { type: 'tool:start'; tool: string; args: object }  // 开始执行工具
  | { type: 'tool:end'; result: unknown }               // 工具执行完成
  | { type: 'error'; error: Error };                    // 执行错误

class AgentRunner {
  // 标准用法：等待完整结果
  async step(state: AgentState): Promise<{
    state: AgentState;
    result: StepResult;
  }>;
  
  // 流式用法：实时观察执行过程
  async *stepStream(state: AgentState): AsyncGenerator<
    StreamEvent,
    { state: AgentState; result: StepResult }
  >;
}

// StepResult = { type: 'continue', toolResult } 
//            | { type: 'done', answer }
```

**执行流程**:
1. 调用 LLM（流式接收 token）
2. 实时 emit token 事件（调试用）
3. 完整响应后解析 Thought + Action
4. 如果有 Action，emit action 事件，执行 Tool
5. 返回新 state 和 result（不可变数据，使用 Immer）

**验收标准**:
- [ ] `step()` 等待完整结果，返回新 state
- [ ] `stepStream()` 实时产生 token/action 事件
- [ ] 流式可以在任意时刻 `break` 中断
- [ ] 两种方法都返回不可变的 AgentState（使用 Immer）

---

#### Step 5: 运行到结束（Run）
**目标**: 自动循环直到完成

```typescript
// 运行结果
type RunResult = 
  | { type: 'success'; answer: string; totalSteps: number }
  | { type: 'max_steps'; partialAnswer?: string; totalSteps: number }
  | { type: 'error'; error: Error; totalSteps: number };

// 跨步骤的流式事件
type RunStreamEvent =
  | { type: 'step:start'; step: number; state: AgentState }
  | StreamEvent  // 包含 step 内部的所有事件
  | { type: 'step:end'; step: number; result: StepResult }
  | { type: 'complete'; result: RunResult };

class AgentRunner {
  // 标准用法：等待完整运行结束
  async run(state: AgentState, options?: {
    maxSteps?: number;  // 默认 10
  }): Promise<{
    state: AgentState;
    result: RunResult;
  }>;
  
  // 流式用法：观察整个运行过程
  async *runStream(state: AgentState, options?: {
    maxSteps?: number;
  }): AsyncGenerator<
    RunStreamEvent,
    { state: AgentState; result: RunResult }
  >;
}
```

**使用示例**:

```typescript
// 标准用法
const { state: finalState, result } = await runner.run(initialState);
console.log(result.answer);

// 流式用法（调试）
const stream = runner.runStream(initialState);
for await (const event of stream) {
  switch (event.type) {
    case 'step:start':
      console.log(`Step ${event.step} started`);
      break;
    case 'token':
      process.stdout.write(event.token);  // 实时显示思考
      break;
    case 'action':
      console.log('Action:', event.tool); // 准备调用工具
      break;
    case 'complete':
      console.log('Done:', event.result.answer);
      break;
  }
}
```

**验收标准**:
- [ ] `run()` 自动循环直到完成，返回最终 state
- [ ] `runStream()` 实时产生跨步骤的事件流
- [ ] 支持流式中断（`break` 跳出循环）
- [ ] 返回不可变的最终 state（使用 Immer）

---

#### Step 6: Runner 配置化
**目标**: Runner 可配置，支持不同策略

```typescript
interface RunnerConfig {
  llm: LLMClient;
  maxSteps?: number;      // 默认 10
  timeout?: number;       // 单步超时（毫秒）
  systemPrompt?: string;  // 覆盖默认 ReAct 提示词
}

class AgentRunner {
  constructor(config: RunnerConfig);
}
```

**验收标准**:
- [ ] 可配置 maxSteps
- [ ] 可配置单步超时时间
- [ ] 可配置自定义 System Prompt

---

### Phase 2: 调试基础（可见性）

#### Step 7: 生命周期钩子
**目标**: 外部能观察到执行过程

```typescript
interface RunnerHooks {
  beforeStep?: (state: AgentState) => void | Promise<void>;
  afterStep?: (state: AgentState, result: StepResult) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
}

class AgentRunner {
  constructor(config: RunnerConfig & { hooks?: RunnerHooks });
}
```

**验收标准**:
- [ ] beforeStep 在每次 LLM 调用前触发
- [ ] afterStep 在每次工具执行后触发
- [ ] 钩子可以异步（支持 await）
- [ ] 钩子抛错不影响执行（或可选是否中断）

---

#### Step 8: 状态快照（Snapshot）
**目标**: 任意时刻能保存状态

```typescript
interface Snapshot {
  version: string;      // 版本号，便于兼容性
  timestamp: number;    // 创建时间
  state: AgentState;    // 完整状态
  checksum: string;     // 完整性校验
}

function createSnapshot(state: AgentState): Snapshot;
function restoreSnapshot(snapshot: Snapshot): AgentState;
```

**验收标准**:
- [ ] 执行中任意时刻可创建快照
- [ ] 快照可 JSON 序列化保存到文件
- [ ] 从快照恢复后状态完全一致
- [ ] 恢复的 Agent 能继续执行

---

#### Step 9: 手动单步调试
**目标**: 开发者能控制执行节奏

```typescript
// 使用方式（外部控制循环）
const runner = new AgentRunner(config);
const state = createAgentState({...});

await runner.step(state);  // 执行一步
inspect(state);            // 查看状态
await runner.step(state);  // 再执行一步
```

**验收标准**:
- [ ] 两次 step() 之间可以插入任意逻辑
- [ ] 可以查看中间状态
- [ ] 可以随时停止（不再继续 step）

---

### Phase 3: 调试增强（干预能力）

#### Step 10: 工具 Mock 系统
**目标**: 开发时工具可 Mock

```typescript
interface ToolMock {
  returnValue?: unknown;
  delay?: number;         // 模拟延迟（ms）
  error?: string;         // 模拟错误
}

class AgentRunner {
  enableMockMode(): void;
  disableMockMode(): void;
  mockTool(name: string, mock: ToolMock): void;
  unmockTool(name: string): void;
}
```

**验收标准**:
- [ ] Mock 模式下，指定工具返回预设值
- [ ] 未 Mock 的工具正常执行
- [ ] 可动态切换 Mock/真实模式
- [ ] Mock 支持延迟模拟

---

#### Step 11: 人机协作暂停点
**目标**: 能在关键节点暂停等用户输入

```typescript
interface PausePoint {
  type: 'before-tool' | 'before-completion';
  context: {
    currentStep: number;
    proposedAction?: ToolCall;
    messages: Message[];
  };
  resume: (input?: string) => void;  // 继续执行
  abort: () => void;                 // 中止执行
}

class AgentRunner {
  async runInteractive(state: AgentState, options: {
    onPause: (point: PausePoint) => void;
  }): Promise<RunResult>;
}
```

**验收标准**:
- [ ] 工具调用前可暂停
- [ ] 用户可输入后继续
- [ ] 用户可中止执行
- [ ] 暂停时状态不丢失

---

#### Step 12: 上下文压缩
**目标**: 防止对话历史无限增长

```typescript
interface CompressionStrategy {
  shouldCompress(state: AgentState): boolean;
  compress(messages: Message[]): Message[];
}

class AgentRunner {
  constructor(config: {
    compression?: {
      threshold: number;  // 超过多少条压缩
      strategy: 'drop' | 'summarize' | CompressionStrategy;
    };
  });
}
```

**验收标准**:
- [ ] 超过阈值自动触发压缩
- [ ] 支持直接丢弃旧消息
- [ ] 支持保留但摘要旧消息
- [ ] 压缩前触发钩子（可观察）

---

#### Step 13: 执行回放（Replay）
**目标**: 能重现一次执行过程

```typescript
interface ExecutionEvent {
  timestamp: number;
  type: 'step-start' | 'llm-call' | 'tool-call' | 'step-end' | 'error';
  payload: unknown;
}

class ExecutionRecorder {
  start(): void;
  record(event: ExecutionEvent): void;
  stop(): ExecutionLog;
  replay(log: ExecutionLog, runner: AgentRunner): Promise<void>;
}
```

**验收标准**:
- [ ] 记录完整执行过程（含时间戳）
- [ ] 回放时按原速度或加速播放
- [ ] 回放时触发相同的钩子事件
- [ ] 可从任意快照开始回放

---

### Phase 4: 工程化（稳定性）

#### Step 14: 并发隔离
**目标**: 多个 AgentState 同时运行互不干扰

```typescript
// 验证 Runner 无状态，可并发使用
const runner = new AgentRunner(config);
const state1 = createAgentState({...});
const state2 = createAgentState({...});

await Promise.all([
  runner.run(state1),
  runner.run(state2)
]);
```

**验收标准**:
- [ ] 两个 Agent 同时运行不冲突
- [ ] 各自的 messages 独立
- [ ] 各自的 stepCount 独立
- [ ] 一个报错不影响另一个

---

#### Step 15: 错误隔离与恢复
**目标**: 单步错误可捕获，Agent 不崩溃

```typescript
type ErrorDecision = 'continue' | 'abort' | { retry: boolean };

interface ErrorHandler {
  (error: Error, context: { 
    state: AgentState; 
    step: number;
    operation: 'llm-call' | 'tool-execute' | 'parse';
  }): ErrorDecision;
}

class AgentRunner {
  constructor(config: {
    onError?: ErrorHandler;
  });
}
```

**验收标准**:
- [ ] LLM 调用失败可捕获
- [ ] 工具执行失败可捕获
- [ ] 可配置重试或中止
- [ ] 错误信息包含上下文（哪一步、什么操作）

---

## 开发建议

### 起步策略

**Phase 1（Step 0-6）** = 基础可用的 ReAct Agent
- 完成后可运行简单的工具调用任务
- 是后续所有功能的基础

**Phase 2（Step 7-9）** = 可见性
- 完成后上层 IDE 可以观察和单步调试
- 不增强功能，只增强可观测性

**Phase 3（Step 10-13）** = 干预能力
- 完成后开发者可以 Mock、暂停、压缩、回放
- 提升开发体验和调试效率

**Phase 4（Step 14-15）** = 生产稳定性
- 完成后可以稳定运行多个 Agent，错误可恢复

### 关键设计决策

1. **ReAct 为主**：Phase 1 只做 ReAct，Plan-and-Execute 后续作为策略扩展
2. **状态纯数据**：AgentState 无方法，只有数据，确保可序列化
3. **Runner 无状态**：同一 Runner 可并发执行多个 AgentState
4. **长期记忆不做**：Phase 1-2 专注对话历史的短期管理
5. **事件驱动调试**：通过钩子而非侵入式代码实现调试能力

---

## 关键设计 Q&A

### Q1: 支持从某一步重新执行？

**支持**，通过快照 + 回退机制：

```typescript
// 方式 A: 从快照恢复后继续
const snapshot = createSnapshot(state); // 在第5步创建快照
const restored = restoreSnapshot(snapshot);
await runner.step(restored); // 从第5步继续

// 方式 B: 回退到某一步重新执行
await runner.rollback(state, { toStep: 3 }); // 回退到第3步
await runner.step(state); // 重新执行第4步
```

### Q2: 工具调用前如何确认？

**不靠步进**，通过钩子或 `runInteractive`：

```typescript
// 钩子拦截（简单确认）
const runner = new AgentRunner({
  hooks: {
    onToolCall: async (call, state) => {
      const confirmed = await showConfirmDialog(call);
      if (!confirmed) throw new Error('Cancelled');
    }
  }
});

// runInteractive（支持修改参数）
await runner.runInteractive(state, {
  onPause: (point) => {
    if (point.type === 'before-tool') {
      showConfirmUI(point.proposedAction, {
        onConfirm: () => point.resume(),
        onCancel: () => point.abort(),
        onModify: (newArgs) => point.resume(newArgs)
      });
    }
  }
});
```

### Q3: 内部思考 vs 对外展示？

通过消息类型区分，Runner 自动处理：

```typescript
interface Message {
  role: 'assistant';
  content: string;
  type: 'thought' | 'final';  // 内部思考 vs 最终答案
  visible: boolean;            // 对外可见性
}

// Runner 自动标记
state.messages.push({
  role: 'assistant',
  content: thought,
  type: 'thought',
  visible: false  // 内部思考，不展示给用户
});

// 获取对外可见的消息
runner.getVisibleMessages(state); // 过滤 visible=true 的
```

### Q4: EventEmitter3 事件体系？

```typescript
import { EventEmitter } from 'eventemitter3';

interface AgentEvents {
  'step:start': (e: { state: AgentState; step: number }) => void;
  'step:end': (e: { state: AgentState; result: StepResult }) => void;
  'llm:call': (e: { messages: Message[] }) => void;
  'tool:call': (e: { tool: string; args: object }) => void;
  'tool:result': (e: { tool: string; result: unknown }) => void;
  'state:changed': (e: { state: AgentState }) => void;
  'pause': (e: { reason: string; resume: Function }) => void;
  'error': (error: Error) => void;
  'complete': (result: RunResult) => void;
}

class AgentRunner extends EventEmitter<AgentEvents> {
  // IDE 层订阅事件
}
```

### Q5: 提示词定义？

**默认内置 ReAct 模板 + 允许覆盖**：

```typescript
// 内置默认
const DEFAULT_REACT_PROMPT = `You are a helpful assistant...
Use the following format:
Thought: your reasoning here
Action: the tool name and arguments
Observation: the tool result
...`;

interface RunnerConfig {
  llm: LLMClient;
  systemPrompt?: string;  // 覆盖默认
}
```

---

## 与上层 IDE 的关系

```
┌─────────────────────────────────────────┐
│           Agent Skill IDE (上层)         │
│  • 可视化工作流编辑                        │
│  • 断点、单步、状态面板                     │
│  • Mock 配置、回放控制                      │
└─────────────────────────────────────────┘
                    │
                    ▼ 订阅事件 / 调用方法
┌─────────────────────────────────────────┐
│              colts (基座)                │
│  • AgentState: 纯数据状态                 │
│  • AgentRunner: 执行引擎 + 钩子 + 事件    │
│  • 工具系统 + Mock 能力                    │
│  • 内置 ReAct 提示词（可覆盖）             │
└─────────────────────────────────────────┘
```

IDE 通过订阅 Runner 的事件获取状态，通过调用 `step()` / `run()` 控制执行。
