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

## 执行粒度定义

### 三级控制粒度

| 粒度 | 方法 | 描述 | 适用场景 |
|------|------|------|----------|
| **微步** | `advance()` / `advanceStream()` | 推进一个执行阶段（Phase） | 精细调试、断点、单步跟踪 |
| **中步** | `step()` / `stepStream()` | 完成一次完整 ReAct 循环 | 标准调试、观察一轮思考-行动 |
| **宏步** | `run()` / `runStream()` | 自动运行直到完成 | 全自动执行、观察整体过程 |

### Phase（微步阶段）

微步将执行拆分为以下阶段：

```
idle → preparing → calling-llm → streaming → llm-response → parsing → parsed
                                                                          ↓
completed ← tool-result ← executing-tool ← [if action]
```

### 什么是 "一次 Step（中步）"？

一次 Step = **一次完整的 ReAct 循环**：

1. 调用 LLM（带上当前对话历史）
2. 解析 LLM 响应，提取 Thought 和 Action
3. 如果有 Action，执行对应工具
4. 更新 AgentState（messages、stepCount）
5. 返回结果类型（继续 或 完成）

**实现**：`step()` 内部由多个 `advance()` 组成

### 什么时候 "Run（宏步）结束"？

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
- [x] 能创建初始状态 (`createAgentState`)
- [x] 能 `JSON.stringify` 序列化 (`serializeState`)
- [x] 能 `JSON.parse` 反序列化并恢复 (`deserializeState`)
- [x] 使用 Immer 进行不可变更新 (`produce`)
- [x] 更新后原状态保持不变（`oldState !== newState`）
- [x] 包含对话历史数组 (`context.messages`)

**状态**: ✅ 已完成 (25 个单元测试，100% 覆盖率)

---

#### Step 1: 基础 LLM 对话
**目标**: 让 Agent 能说话（不解析，只对话）

```typescript
class AgentRunner {
  // 简单对话，返回更新后的状态（包含对话历史）
  async chat(state: AgentState, userInput: string): Promise<{
    state: AgentState;  // 新状态（添加了 user 和 assistant 消息）
    response: string;    // LLM 的回复内容
  }>;
  
  // 流式对话：实时观察 LLM 输出
  async *chatStream(state: AgentState, userInput: string): AsyncGenerator<{
    type: 'token' | 'complete';
    token?: string;
    state?: AgentState;
    response?: string;
  }>;
}
```

**验收标准**:
- [x] 输入 "Hello"，返回 LLM 的回复和新状态 (`runner.chat`)
- [x] 多次调用能看到历史上下文（通过返回的 state 传递）
- [x] 原 state 保持不变（不可变）
- [x] stepCount 始终为 0（还没开始 ReAct）
- [x] `chatStream()` 实时产生 token，最终返回完整 state

**状态**: ✅ 已完成 (15 个单元测试 + 11 个集成测试，99.4% 覆盖率)

---

#### Step 2: Response 解析器
**目标**: 解析 LLM 的 Function Calling 响应，提取 Thought 和 Tool Call

```typescript
// LLM 返回的工具调用
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// 解析结果
interface ParseResult {
  thought: string;           // LLM 的思考过程（reasoning_content 或 content）
  toolCalls: ToolCall[];     // 工具调用列表（可能为空）
  isFinalAnswer: boolean;    // 是否直接给出最终答案
}

// 解析函数
function parseResponse(response: LLMResponse): ParseResult;
```

**输入格式**（OpenAI Function Calling 标准）：
```json
{
  "content": "Let me calculate that for you.",
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "calculate",
        "arguments": "{\"expression\": \"15 + 23\"}"
      }
    }
  ]
}
```

**判断逻辑**:
- `tool_calls` 存在且非空 → `isFinalAnswer = false`，执行工具
- `tool_calls` 为空 → `isFinalAnswer = true`，返回 content 作为答案

**验收标准**:
- [x] 能解析带 tool_calls 的响应（需要调用工具）
- [x] 能解析纯文本响应（直接给出最终答案）
- [x] 支持解析 reasoning_content（思考过程）
- [x] 解析失败时抛出明确错误
- [x] 工具参数为有效的 JSON 对象

**状态**: ✅ 已完成 (17 个单元测试，100% 覆盖率)

---

#### Step 3: 工具系统基础
**目标**: 能定义和执行工具，使用 Zod 进行参数定义和验证

```typescript
import { z } from 'zod';

// 工具定义接口
interface Tool<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  // 使用 Zod 定义参数结构（自动生成 JSON Schema 给 LLM）
  parameters: TParams;
  // 执行函数，参数类型由 Zod 推导
  execute: (args: z.infer<TParams>) => Promise<unknown>;
}

// 工具注册表
class ToolRegistry {
  // 注册工具
  register<T extends z.ZodTypeAny>(tool: Tool<T>): void;
  
  // 执行工具（内部自动验证参数）
  execute(name: string, args: unknown): Promise<unknown>;
  
  // 获取工具的 JSON Schema（传给 LLM）
  getToolSchemas(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: object; // JSON Schema
    };
  }>;
}

// 使用示例
const calculatorTool: Tool<typeof calculatorSchema> = {
  name: 'calculate',
  description: 'Calculate a mathematical expression',
  parameters: z.object({
    expression: z.string().describe('Math expression like "15 + 23"'),
  }),
  execute: async ({ expression }) => {
    // 参数已自动验证，类型安全
    return eval(expression).toString();
  },
};
```

**设计要点**:
- **Zod 优先**: 用户使用熟悉的 Zod API 定义参数
- **类型推导**: `execute` 函数的参数自动获得 TypeScript 类型
- **自动转换**: 内部使用 `zod-to-json-schema` 转换为标准格式
- **运行时验证**: 执行前自动验证 LLM 返回的参数
- **Provider 无关**: 返回 OpenAI 标准格式，pi-ai 内部自动转换给其他 Provider

**API 设计**:
```typescript
class ToolRegistry {
  // 注册工具
  register<T extends z.ZodTypeAny>(tool: Tool<T>): void;
  
  // 获取工具
  get(name: string): Tool | undefined;
  has(name: string): boolean;
  getToolNames(): string[];
  
  // 执行工具（自动验证参数）
  async execute(name: string, args: unknown): Promise<unknown>;
  
  // 生成工具 Schema（给 LLM 用）
  toToolSchemas(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: object; // JSON Schema
    };
  }>;
}
```

**新增依赖**:
```json
{
  "dependencies": {
    "zod": "^3.22.0",
    "zod-to-json-schema": "^3.22.0"
  }
}
```

**验收标准**:
- [x] 能用 Zod 定义工具参数
- [x] 执行时自动验证参数类型，失败时抛出清晰错误
- [x] 自动生成 JSON Schema 给 LLM (toToolSchemas)
- [x] 支持可选参数、默认值、枚举等常见 Zod 特性
- [x] 工具不存在时抛错
- [x] 内置 calculator 工具作为示例

**状态**: ✅ 已完成 (31 个单元测试，100% 覆盖率)

---

#### Step 4: 三级执行控制
**目标**: 支持细粒度到粗粒度的多种控制方式

##### Phase 状态机

```typescript
// 执行阶段（微步粒度）
type Phase =
  | { type: 'idle' }                                      // 初始状态
  | { type: 'preparing'; messages: Message[] }            // 准备 Prompt
  | { type: 'calling-llm' }                               // 正在调用 LLM
  | { type: 'llm-response'; response: string }            // 收到完整响应
  | { type: 'parsing' }                                   // 解析响应中
  | { type: 'parsed'; thought: string; action?: Action }  // 解析完成
  | { type: 'executing-tool'; action: Action }            // 执行工具中
  | { type: 'tool-result'; result: unknown }              // 工具返回结果
  | { type: 'completed'; answer: string }                 // 任务完成
  | { type: 'error'; error: Error };                      // 执行错误
```

**Phase 转换图**（每个箭头 = 一次 `advance()` 调用）:

```
idle → preparing → calling-llm → llm-response → parsing → parsed
                                                              │
                                              ┌─────── action? ───────┐
                                              │ no action              │ has action
                                              ▼                        ▼
                                         completed            executing-tool
                                                                    │
                                                                    ▼
                                                             tool-result
                                                                    │
                                                                    ▼
                                                              completed
```

**关键规则**:
- 每次调用 `advance()` 严格推进一个 phase（不存在跳过）
- 只有 `completed` 和 `error` 是终止 phase（`done: true`）
- `streaming` 不是独立 phase，而是流式变体在 `calling-llm` 内部的观察方式（见下文"流式策略"）

##### advance() 的状态更新策略

**核心原则**：advance 是真正的执行单元，每次有实质变更就必须产生新的 AgentState。唯一的例外是流式接收中，在流完成前不更新。

各 phase 对 AgentState 的影响：

| 转换 | AgentState 变更 | 写入内容 | state 引用 |
|------|----------------|---------|-----------|
| idle → preparing | 无 | — | 同一引用 |
| preparing → calling-llm | 无 | — | 同一引用 |
| calling-llm → llm-response | 无 | — | 同一引用 |
| llm-response → parsing | 无 | — | 同一引用 |
| parsing → parsed | 无 | — | 同一引用 |
| parsed → executing-tool (有 action) | **有** | assistant thought 消息 (visible: false) | **新 state** |
| executing-tool → tool-result | **有** | tool 消息 + stepCount++ | **新 state** |
| parsed → completed (无 action) | **有** | assistant final 消息 (visible: true) + stepCount++ | **新 state** |
| tool-result → completed | 无 | — | 同一引用 |

**写入时机的选择理由**：
- `llm-response` 不写入：此时尚未解析，不知道是 thought 还是 final answer
- `parsed → executing-tool` 写入 thought：此时已解析出 thought，且即将执行工具
- `tool-result` 写入 tool 消息：工具执行完毕，结果已知
- `completed`（直接回答路径）写入 final 消息：确认是最终答案
- `tool-result → completed` 不写入：消息已在前面写入，避免重复

**state 更新的实际含义**：

```
advance(state, execState) 的处理逻辑：

1. 判断当前 phase，执行对应的转换操作
2. 如果该转换需要写入消息（parsed→executing-tool, executing-tool→tool-result, parsed→completed）：
   - 使用 state.ts 中的 addAssistantMessage / addToolMessage / incrementStepCount 创建新 state
   - 这些函数内部使用 Immer produce() 保证不可变
   - 返回新 state
3. 如果该转换无新数据（过渡 phase）：
   - 直接返回原 state（同一引用）
```

**设计要点**：
- advance 是独立的执行单元，可以脱离 step 单独使用
- 调用方可以在任意 phase 暂停，此时 AgentState 反映了到该 phase 为止的所有变更
- ExecutionState 记录的是推进过程中的中间数据（phase、preparedMessages 等），与 AgentState 中的 messages 互补
- 流式变体在 `calling-llm` 阶段用 `llmClient.stream()` 替代 `llmClient.call()`，**流完成前不更新 AgentState，流完成后一次性写入**

##### step() 与 advance() 的关系

step 是 advance 的便捷组合：

```
step(state) {
  创建 ExecutionState
  let state = initialState
  while (true) {
    const result = advance(state, execState, registry)
    state = result.state        // advance 可能返回新 state
    if (result.done) {
      return { state, result: ... }
    }
    // tool-result 也是 step 的终止点（需要外部决定是否继续）
    if (result.phase.type === 'tool-result') {
      return { state, result: { type: 'continue', toolResult: ... } }
    }
  }
}
```

**关键**：step 不负责"补写" state——advance 在执行过程中已经逐步写入了（thought、tool message、final answer）。step 只是把多个 advance 编排成一次完整的 ReAct 循环，并返回合适的 StepResult。唯一的例外是 error 路径，step 负责将错误信息写入 state。

##### API 签名

```typescript
// 流式事件（用于 observe，不改变状态）
type StreamEvent =
  | { type: 'phase-change'; from: Phase; to: Phase }
  | { type: 'token'; token: string }
  | { type: 'tool:start'; action: Action }
  | { type: 'tool:end'; result: unknown };

// 步骤结果
type StepResult =
  | { type: 'continue'; toolResult: unknown }
  | { type: 'done'; answer: string };

class AgentRunner {
  // 微步：细粒度阶段推进
  // 每调用一次，推进到下一个自然断点
  // 在产生实质变更的 phase（llm-response, tool-result, completed）返回新 state
  // 在中间过渡 phase 返回原 state（同一引用）
  async advance(
    state: AgentState,
    execState: ExecutionState,
    toolRegistry?: ToolRegistry
  ): Promise<{
    state: AgentState;      // 有变更时是新 state，无变更时是原 state
    phase: Phase;           // 推进到的 phase
    done: boolean;          // 是否终止 phase
  }>;

  // 中步：完整的 ReAct 循环（ Thought → Action → Observation ）
  // 由多个 advance() 组成，advance 过程中已逐步更新 AgentState
  async step(
    state: AgentState,
    toolRegistry?: ToolRegistry
  ): Promise<{
    state: AgentState;      // 新 state（Immer 产生）
    result: StepResult;
  }>;
}
```

##### 流式策略

流式变体（`stepStream`、`advanceStream`）**复用核心逻辑，不重新实现 phase 遍历**：

```
advanceStream(state, execState) 的处理逻辑：

1. 判断当前 phase
2. 如果 phase === 'calling-llm'：
   - 用 llmClient.stream() 替代 llmClient.call()
   - 流接收过程中：yield token 事件，不更新 state
   - 流完成后：和阻塞模式一样，写入 state 并进入 llm-response phase
3. 其他 phase：直接调用 advance() 的逻辑，yield phase-change 事件
```

**关键规则**:
- `streaming` 是一个仅在流式模式中出现的**内部观察 phase**，只出现在 `advanceStream()` / `stepStream()` 的 `phase-change` 事件中，不出现在 `advance()` 的返回值中。它标记"正在流式接收 LLM 响应"这个中间状态，让 UI 可以区分"正在等待 LLM"和"正在接收 token"
- 流式变体在 `calling-llm` phase 用 `llmClient.stream()` 替代 `llmClient.call()`，其余 phase 全部复用 `advance()` 的逻辑
- `advanceStream()` = `advance()` 的骨架 + 在 `calling-llm` 时 yield token 事件
- **流式接收期间不更新 AgentState，流完成后一次性写入**（与"一次问话"的语义一致）

##### 使用方式对比

```typescript
// 微步：细粒度控制（每个阶段都停）
let state = createAgentState({...});
const execState = createExecutionState();

while (true) {
  const { state: newState, phase, done } = await runner.advance(state, execState);

  // 在有变更的 phase，newState !== state（新 state 包含新消息）
  // 在过渡 phase，newState === state（同一引用）
  state = newState;

  console.log('进入阶段:', phase.type);
  if (newState !== state) {
    console.log('state 已更新，消息数:', state.context.messages.length);
  }

  // 在 parsed phase 干预：修改 action 参数
  if (phase.type === 'parsed' && phase.action) {
    if (userWantsToModify) {
      execState.action.arguments = newArgs;
    }
  }

  if (done) break;
}

// 中步：一次完整的 ReAct 循环
const { state: newState, result } = await runner.step(state);
// newState 是 advance 链中最后一次有变更时产生的 state

// 中步流式：观察完整过程
for await (const event of runner.stepStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'tool:start') console.log('调用工具:', event.action.tool);
}
```

##### 验收标准
- [x] `advance()` 每次推进一个自然阶段，返回当前 phase
- [x] `advance()` 在产生实质变更的 phase（llm-response, tool-result, completed）用 Immer 返回新 AgentState
- [x] `advance()` 在过渡 phase 返回原 state（同一引用）
- [x] 可在任意 phase 暂停，此时 AgentState 反映到该 phase 为止的所有变更
- [x] `step()` 内部由多个 `advance()` 组成，state 在 advance 过程中已逐步更新
- [x] `stepStream()` 复用 `advance()` 核心逻辑，仅在 `calling-llm` 阶段注入流式读取
- [x] `stepStream()` 只调用一次 LLM（不重复调用）
- [x] `advanceStream()` 不引入 `streaming` 作为独立 phase
- [x] 所有方法返回的 AgentState 遵循不可变原则（新 state 由 Immer produce 创建）

---

#### Step 5: 运行到结束（Run）
**目标**: 自动循环直到完成

```typescript
// 运行结果
type RunResult = 
  | { type: 'success'; answer: string; totalSteps: number }
  | { type: 'max_steps'; totalSteps: number }  // partialAnswer 暂不提供
  | { type: 'error'; error: Error; totalSteps: number };

// 跨步骤的流式事件
type RunStreamEvent =
  | { type: 'step:start'; step: number; state: AgentState }
  | { type: 'step:end'; step: number; result: StepResult }
  | StreamEvent  // step 内部的所有事件（token、phase-change、tool:start/end）
  | { type: 'complete'; result: RunResult };

class AgentRunner {
  // 🏃 跑步：自动循环直到完成
  async run(state: AgentState, options?: {
    maxSteps?: number;  // 默认 10
  }): Promise<{
    state: AgentState;
    result: RunResult;
  }>;
  
  // 跑步流式：观察整个运行过程（多轮 step）
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
// 🏃 跑步：全自动运行
const { state: finalState, result } = await runner.run(initialState);
console.log(result.answer);

// 跑步流式：逐字输出
for await (const event of runner.runStream(initialState)) {
  switch (event.type) {
    case 'token':
      process.stdout.write(event.token);  // 逐字输出
      break;
    case 'step:end':
      console.log(`\nStep ${event.step} done`);
      break;
    case 'complete':
      console.log('Finished:', event.result);
      break;
  }
}
```

**实现关系**:
- `run()` = 循环调用 `step()` 直到完成
- `step()` = 循环调用 `advance()` 直到一个 ReAct 完成
- `runStream()` = 循环调用 `stepStream()` 直到完成（**不是**包装 `run()`）
- `run()` 和 `runStream()` 是**平行关系**，各自循环对应的 step 方法

**maxSteps 行为**:
- 达到 maxSteps 时返回 `{ type: 'max_steps', totalSteps }`，不提供 partialAnswer
- 每次 `step()` 调用计为一步（无论是否执行工具）

**验收标准**:
- [x] `run()` 自动循环直到完成，返回最终 state
- [x] `runStream()` 实时产生跨步骤的事件流（含逐字 token）
- [x] `runStream()` 内部调用 `stepStream()`，能逐字转发 LLM 输出
- [x] 支持流式中断（`break` 跳出循环）
- [x] 返回不可变的最终 state（使用 Immer）
- [x] 达到 maxSteps 时正确返回 `max_steps` 结果

---

#### Step 6: Runner 配置化与依赖反转
**目标**: Runner 可配置，依赖接口而非实现，所有方法返回不可变状态

##### 依赖反转：定义接口

Runner 不依赖具体的 LLMClient 或 ToolRegistry 类，而是依赖接口。
接口定义在 colts 包内，数据类型通过 `import type` 从 llm-client 引入（纯编译时，无运行时依赖）。

```typescript
import type { LLMResponse, StreamEvent, TokenStats } from '@agentskillmania/llm-client';

// ========== Runner 依赖的接口 ==========

/**
 * LLM 提供者接口
 *
 * Runner 通过此接口与 LLM 交互，不依赖具体实现。
 * 现有的 @agentskillmania/llm-client 的 LLMClient 满足此接口。
 */
interface ILLMProvider {
  /** 阻塞式调用 */
  call(options: {
    model: string;
    messages: Message[];
    tools?: Tool[];
    priority?: number;
    requestTimeout?: number;
  }): Promise<LLMResponse>;

  /** 流式调用 */
  stream(options: {
    model: string;
    messages: Message[];
    tools?: Tool[];
    priority?: number;
    requestTimeout?: number;
  }): AsyncIterable<StreamEvent>;
}

/**
 * 工具注册表接口
 *
 * Runner 通过此接口执行工具和获取工具 Schema，不依赖具体实现。
 * 现有的 ToolRegistry 类满足此接口。
 */
interface IToolRegistry {
  /** 执行指定工具 */
  execute(name: string, args: unknown): Promise<unknown>;
  /** 获取所有工具的 JSON Schema（传给 LLM） */
  toToolSchemas(): ToolSchema[];
}
```

##### RunnerOptions：注入 + 便捷构造

```typescript
/**
 * LLM 快速初始化配置
 * 传此对象时，Runner 内部自动创建 LLMClient 实例
 */
interface LLMQuickInit {
  /** API Key */
  apiKey: string;
  /** Provider 名称（默认 'openai'） */
  provider?: string;
  /** 自定义 Base URL（可选） */
  baseUrl?: string;
  /** 并发限制：同时发出的最大请求数（默认 5，应用到 provider/key/model 三级） */
  maxConcurrency?: number;
}

/**
 * 工具快速初始化配置
 * 传此对象时，Runner 内部自动创建 ToolRegistry 并注册
 */
type ToolQuickInit = Tool<z.ZodTypeAny>[];

class AgentRunner {
  constructor(options: {
    // --- LLM：注入或快速初始化（二选一，都传则报错） ---
    llmClient?: ILLMProvider;       // 注入已有实例
    llm?: LLMQuickInit;             // 快速初始化参数

    // --- 工具：注入或快速初始化（都传则合并） ---
    toolRegistry?: IToolRegistry;   // 注入已有实例
    tools?: ToolQuickInit;          // 快速初始化参数

    // --- Runner 配置 ---
    model: string;                  // 模型标识（注入 llmClient 时仍需指定）
    systemPrompt?: string;          // 系统提示词
    requestTimeout?: number;        // 单步超时（毫秒）
    maxSteps?: number;              // 默认最大步数（默认 10）
    hooks?: RunnerHooks;            // 生命周期钩子（Step 7 实现）
  });

  // 工具便捷操作（代理到内部 ToolRegistry）
  registerTool<T extends z.ZodTypeAny>(tool: Tool<T>): void;
  unregisterTool(name: string): boolean;

  // 所有执行方法都返回 { state, ... }，state 为不可变新状态
  // - advance() / advanceStream()
  // - step() / stepStream()
  // - run() / runStream()
  // - chat() / chatStream()
}
```

##### 初始化逻辑

```
构造时初始化规则：

1. LLM 提供者（互斥，冲突则报错）：
   - 传 llmClient → 直接使用
   - 传 llm → 内部创建 LLMClient，流程如下：
     ```
     const c = llm.maxConcurrency ?? 5;
     const client = new LLMClient({ baseUrl: llm.baseUrl });
     client.registerProvider({ name: llm.provider ?? 'openai', maxConcurrency: c });
     client.registerApiKey({
       key: llm.apiKey,
       provider: llm.provider ?? 'openai',
       maxConcurrency: c,
       models: [{ modelId: options.model, maxConcurrency: c }],
     });
     ```
   - 都传 → 抛出 ConfigurationError
   - 都不传 → 抛出 ConfigurationError

2. 工具注册表（可合并）：
   - 传 toolRegistry → 作为基础 registry
   - 传 tools → 注册到 registry 中
   - 两个都传 → 用传入的 toolRegistry，再把 tools 注册进去
   - 都不传 → 内部创建空 ToolRegistry

3. maxSteps 层级：
   - RunnerOptions.maxSteps 为默认值（默认 10）
   - run() / runStream() 的 options.maxSteps 可覆盖
   - 优先级：run 参数 > RunnerOptions > 默认值 10
```

**使用示例**:

```typescript
// 方式 A：完全注入（适合生产、测试）
const runner = new AgentRunner({
  llmClient: existingClient,
  toolRegistry: existingRegistry,
  model: 'gpt-4',
});

// 方式 B：快速初始化（适合开发、原型）
const runner = new AgentRunner({
  llm: { apiKey: 'sk-...', provider: 'openai', baseUrl: 'https://...' },
  tools: [calculatorTool, searchTool],
  model: 'gpt-4',
  maxSteps: 5,
});

// 方式 C：混合（LLM 注入 + 工具快速创建）
const runner = new AgentRunner({
  llmClient: existingClient,
  tools: [calculatorTool],
  model: 'gpt-4',
});

// 运行时动态添加工具
runner.registerTool(weatherTool);
runner.unregisterTool('calculator');
```

**验收标准**:
- [x] 定义 ILLMProvider 接口，Runner 依赖接口不依赖具体 LLMClient 类
- [x] 定义 IToolRegistry 接口，Runner 依赖接口不依赖具体 ToolRegistry 类
- [x] 支持注入已有 llmClient 实例
- [x] 支持传 llm 快速初始化参数，内部自动创建 LLMClient
- [x] llmClient 和 llm 都传时抛 ConfigurationError
- [x] 支持注入已有 toolRegistry 实例
- [x] 支持传 tools 数组快速初始化
- [x] toolRegistry 和 tools 都传时合并（registry 为基础，tools 追加注册）
- [x] 可配置 maxSteps 作为 Runner 级别默认值
- [x] run()/runStream() 的 maxSteps 可覆盖 Runner 级别默认值
- [x] registerTool() / unregisterTool() 便捷方法可用
- [x] 所有执行方法返回 `{ state, ... }` 结构
- [x] 返回的 state 是新的不可变对象（Immer 创建）
- [x] 原 state 保持不变

---

### Phase 2: 调试基础（可见性）

#### Step 7: 生命周期钩子（⏭️ 跳过 — 由流式事件体系替代）

**跳过原因**: Step 4-5 实现的流式事件体系（`runStream` / `stepStream` / `advanceStream`）已完整覆盖本 Step 的所有目标。每个钩子的功能都有对应的流式事件：

| 原设计钩子 | 对应的流式事件 |
|---|---|
| `beforeStep(state, step)` | `runStream` 的 `step:start` 事件 |
| `afterStep(state, result)` | `runStream` 的 `step:end` 事件 |
| `onToolCall(state, call)` | `stepStream` 的 `tool:start` 事件 |
| `onToolResult(state, result)` | `stepStream` 的 `tool:end` 事件 |

此外流式事件还提供了 hooks 未覆盖的能力：`phase-change`（阶段变化观察）、`token`（逐字输出）、`complete`（运行完成）。

**使用方式**: 需要观察执行过程时，使用 `*Stream` 方法并迭代事件即可，无需额外的 hooks 机制。

---

#### Step 8: 状态快照（Snapshot）✅ 已完成（Step 0 中实现）

**实现位置**: `src/state.ts`，函数：`createSnapshot`、`restoreSnapshot`、`serializeState`、`deserializeState`

**测试覆盖**: `test/unit/state.test.ts`（27 个测试）+ `test/integration/00-state-lifecycle.test.ts`

**验收标准**:
- [x] 执行中任意时刻可创建快照（`createSnapshot` 使用 `structuredClone` 深拷贝 + checksum）
- [x] 快照可 JSON 序列化保存到文件（`serializeState` / `deserializeState`）
- [x] 从快照恢复后状态完全一致（`restoreSnapshot` 验证 checksum 确保数据完整性）
- [x] 恢复的 Agent 能继续执行（恢复的 AgentState 可直接传入 `addUserMessage` 等 state 操作继续使用）

---

#### Step 9: 手动单步调试 ✅ 已完成（Step 4 中实现）

**实现位置**: `src/runner.ts`，方法：`step()`、`advance()`、`stepStream()`、`advanceStream()`

**测试覆盖**: `test/unit/execution.test.ts`（Invariants 测试组 + 各 describe 中的不可变性验证）

**验收标准**:
- [x] 每次 step/advance 返回新的 state（`step()` 返回 `{ state, result }`，`advance()` 返回 `{ state, phase, done }`）
- [x] 需要显式更新 state 引用才能继续（调用方必须 `state = result.state`，不更新则用过期数据）
- [x] 可以查看和对比新旧状态（原 state 保持不变，测试验证 `originalState.context.stepCount` 不受影响）
- [x] 可以随时停止执行（`advance()` 的 while 循环由调用方控制，`break` 即停）

---

### Phase 3: 调试增强（干预能力）

#### Step 10: 工具 Mock 系统（⏭️ 跳过 — 由依赖注入替代）

**跳过原因**: Step 6 的依赖反转（`IToolRegistry` 接口注入）已提供更灵活的 Mock 方案。Runner 通过 `IToolRegistry.execute()` 调用工具，用户只需注入一个包含 Mock 工具的 Registry 即可，无需 Runner 额外承担 Mock 职责。

```typescript
// Mock 方式：注入包含 Mock 工具的 Registry
const mockRegistry = new ToolRegistry();
mockRegistry.register({
  name: 'api',
  description: 'mocked',
  parameters: z.object({}),
  execute: async () => 'mocked result',        // 返回预设值
  // execute: async () => { await delay(100); throw new Error('mock error'); },  // 延迟/错误模拟
});

const runner = new AgentRunner({
  llmClient: client,
  toolRegistry: mockRegistry,
});
```

**对比原设计**：
- 原设计需要 Runner 新增 `mockTool()` / `enableMockMode()` 等方法和内部状态
- 依赖注入方案零新代码，且粒度更细（完全自定义 execute 行为）
- 如果后续需要便捷的 Mock 工具类，可作为独立的 `MockToolRegistry` 工具提供，无需修改 Runner

---

#### Step 11: 内置 ask_human 工具（Human-in-the-Loop）
**目标**: 提供标准化的 LLM-人类交互工具，让 LLM 能主动向人类提问

##### 设计理念

HITL 不是 Runner 的特殊机制，而是一个**普通工具**。LLM 需要人类输入时，调用 `ask_human` 工具，工具的 `execute()` 通过注入的 handler 与人类交互。这个机制天然兼容所有执行方法（advance / step / run 及其流式版本），因为它们最终都走 `registry.execute()`。

##### 核心类型

```typescript
/** 问题类型 */
type QuestionType = 'text' | 'number' | 'single-select' | 'multi-select';

/** 单个问题 */
interface Question {
  /** 问题标识，用于匹配回答 */
  id: string;
  /** 问题文本 */
  question: string;
  /** 问题类型 */
  type: QuestionType;
  /** 选项列表（single-select / multi-select 时必填） */
  options?: string[];
}

/**
 * 单个问题的回答
 *
 * 两种模式：
 * - direct: 正面回答了问题
 * - free-text: 用户没有正面回答，而是说了自己想说的
 */
type Answer =
  | { type: 'direct'; value: string | number | string[] }
  | { type: 'free-text'; value: string };

/** 人类回复（question id → answer） */
type HumanResponse = Record<string, Answer>;

/** 外部注入的交互 handler（由使用者提供 UI 实现） */
interface AskHumanHandler {
  (params: {
    questions: Question[];
    context?: string;
  }): Promise<HumanResponse>;
}
```

##### 工厂函数

```typescript
/**
 * 创建 ask_human 工具
 *
 * @param handler - 使用者提供的人类交互 handler
 * @returns 可注册到 ToolRegistry 的工具
 */
function createAskHumanTool(handler: AskHumanHandler): Tool {
  return {
    name: 'ask_human',
    description: 'Ask the human one or more questions when you need clarification or input',
    parameters: z.object({
      questions: z.array(z.object({
        id: z.string().describe('Unique identifier for this question'),
        question: z.string().describe('The question to ask'),
        type: z.enum(['text', 'number', 'single-select', 'multi-select']),
        options: z.array(z.string()).optional().describe('Options (required for select types)'),
      })),
      context: z.string().optional().describe('Why you are asking, helps the human understand'),
    }),
    execute: async ({ questions, context }) => {
      return handler({ questions, context });
    }),
  };
}
```

##### 使用示例

```typescript
// CLI 应用
const askHuman = createAskHumanTool({
  handler: async ({ questions, context }) => {
    if (context) console.log(`[Context] ${context}`);
    const answers: HumanResponse = {};
    for (const q of questions) {
      const input = readline.question(`${q.question} > `);
      answers[q.id] = { type: 'direct', value: input };
    }
    return answers;
  },
});

const runner = new AgentRunner({
  model: 'gpt-4',
  llm: { apiKey: 'sk-...' },
  tools: [askHuman],
});

// LLM 自主决定何时调用 ask_human，无需调用方干预
const { result } = await runner.run(state);
```

```typescript
// Web 应用
const askHuman = createAskHumanTool({
  handler: async ({ questions, context }) => {
    // 通过 WebSocket 推送问题到前端
    // 返回的 Promise 在前端提交答案后 resolve
    return websocket.sendAndWaitResponse({ questions, context });
  },
});
```

##### 回答语义示例

```typescript
// LLM 提问：
{
  questions: [
    { id: 'address', question: '收货地址？', type: 'text' },
    { id: 'size', question: '尺码？', type: 'single-select', options: ['S', 'M', 'L'] },
  ]
}

// 正常回答：
{
  address: { type: 'direct', value: '北京市朝阳区xxx' },
  size: { type: 'direct', value: 'M' },
}

// 用户在 address 问题上跑题了（per-question free-text）：
{
  address: { type: 'free-text', value: '我不想买了，帮我退货' },
  size: { type: 'direct', value: 'M' },
}
```

##### LLM System Prompt 建议

使用 ask_human 工具时，建议在 AgentConfig.instructions 或 systemPrompt 中加入：

```
You have access to the ask_human tool. Use it when:
- You need information only the human can provide
- You are uncertain about the user's intent
- A decision has significant consequences and needs confirmation
Ask concise, specific questions. Prefer structured types (single-select, multi-select) over free-text when possible.
```

##### 实现位置

- `src/tools/ask-human.ts` — 工厂函数和类型定义
- `src/tools/index.ts` — 导出

##### 验收标准:
- [x] `createAskHumanTool(handler)` 返回符合 Tool 接口的工具
- [x] 支持 text、number、single-select、multi-select 四种问题类型
- [x] 支持批量提问（一组问题一次调用）
- [x] 每个问题的回答支持 direct（正面回答）和 free-text（用户自由回复）两种模式
- [x] 通过 IToolRegistry 注册后，LLM 可自主决定何时调用
- [x] 兼容所有执行方法（advance / step / run 及流式版本）
- [x] 不修改 Runner 代码，纯工具层面实现

**状态**: ✅ 已完成 (17 个单元测试，100% 覆盖率)

---

#### Step 12: 上下文压缩
**目标**: 防止对话历史无限增长，支持自动和手动压缩

##### 核心设计原则

**messages 是"发生了什么"，LLM 收到的是"需要知道什么"。** 压缩不修改 messages，而是在 AgentState 中存储压缩元数据，`buildMessages()` 根据元数据构造 LLM 视图。

##### AgentState 变更

```typescript
interface AgentContext {
  messages: Message[];           // 完整历史，永远不删
  stepCount: number;
  lastToolResult?: unknown;
  /** 压缩元数据（有值表示已压缩） */
  compression?: {
    /** messages[0..anchor-1] 的摘要文本 */
    summary: string;
    /** 分界线索引：此索引之前的消息已被摘要，不再发给 LLM */
    anchor: number;
  };
}
```

**buildMessages() 行为变化**：

```
无压缩：messages 全部发给 LLM（现有行为不变）

有压缩：构造 [摘要 system 消息] + messages[anchor..end]
  ┌─────────────────────────────────────────────────────┐
  │ [System] 对话历史摘要：用户询问了天气，Agent 查询了... │  ← summary
  │ [Assistant] Understood.                               │
  │ [User] 再查一下明天的                                  │  ← messages[anchor]
  │ [Assistant] 明天晴天...                               │  ← messages[anchor+1]
  └─────────────────────────────────────────────────────┘
```

##### 压缩器接口（依赖倒置）

```typescript
interface CompressResult {
  /** 被压缩消息的摘要文本 */
  summary: string;
  /** 分界线索引：messages[0..anchor-1] 被压缩，messages[anchor..] 保留原文 */
  anchor: number;
}

interface IContextCompressor {
  /** 判断是否需要压缩 */
  shouldCompress(state: AgentState): boolean;
  /** 执行压缩，返回元数据（不改 messages） */
  compress(state: AgentState): Promise<CompressResult>;
}
```

##### 内置默认压缩器

```typescript
interface CompressionConfig {
  /** 压缩阈值（配合 thresholdType 使用，默认 50） */
  threshold?: number;
  /** 阈值类型（默认 'message-count'） */
  thresholdType?: 'message-count' | 'estimated-tokens';
  /** 压缩策略（默认 'sliding-window'） */
  strategy?: 'truncate' | 'sliding-window' | 'summarize' | 'hybrid';
  /** sliding-window / hybrid 保留最近 N 条消息（默认 10） */
  keepRecent?: number;
}

class DefaultContextCompressor implements IContextCompressor {
  constructor(config?: CompressionConfig, llmProvider?: ILLMProvider, model?: string);
  // truncate:     summary = '', anchor = messages.length - keepRecent
  // sliding-window: 同 truncate（不生成摘要）
  // summarize:    调 LLM 生成摘要，anchor = messages.length - keepRecent
  // hybrid:       summarize + sliding-window（摘要老消息 + 保留最近原文）
}
```

- `truncate`：直接截断，不生成摘要
- `sliding-window`：同 truncate，语义更清晰
- `summarize`：需要 `llmProvider`，调用 LLM 生成摘要
- `hybrid`：摘要老消息 + 保留最近原文

##### RunnerOptions 变更

```typescript
interface RunnerOptions {
  // ... 现有字段
  /** 压缩器：传 CompressionConfig 使用默认实现，传 IContextCompressor 使用自定义 */
  compressor?: CompressionConfig | IContextCompressor;
}
```

##### 调用机制

**自动压缩**：每个 advance() 执行后，在 step()/run() 循环内自动检查：

```typescript
// step() 内部
while (!isTerminalPhase(execState.phase)) {
  const { state: newState } = await this.advance(currentState, execState, registry);
  currentState = await this.maybeCompress(newState);  // 每步后检查
  // ...
}

private async maybeCompress(state: AgentState): Promise<AgentState> {
  if (!this.compressor || !this.compressor.shouldCompress(state)) return state;
  const result = await this.compressor.compress(state);
  return produce(state, draft => {
    draft.context.compression = { summary: result.summary, anchor: result.anchor };
  });
}
```

**手动压缩**：

```typescript
class AgentRunner {
  /** 手动触发压缩，返回新的 AgentState（不可变） */
  async compress(state: AgentState): Promise<AgentState>;
}
```

##### 压缩事件（流式通知）

```typescript
type StreamEvent =
  | ... 现有事件
  | { type: 'compressing' }
  | { type: 'compressed'; summary: string; removedCount: number };
```

##### 使用示例

```typescript
// 使用默认压缩器
const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: client,
  compressor: {
    threshold: 50,
    strategy: 'hybrid',
    keepRecent: 10,
  },
});

// 自动压缩：run/step 内部自动触发，调用方无需干预
const { result } = await runner.run(state);

// 手动压缩
const compressedState = await runner.compress(state);

// 自定义压缩器
class MyCompressor implements IContextCompressor {
  shouldCompress(state) { return state.context.messages.length > 100; }
  async compress(state) {
    // 自定义压缩逻辑
    return { summary: '...', anchor: state.context.messages.length - 20 };
  }
}
const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: client,
  compressor: new MyCompressor(),
});
```

##### 验收标准:
- [x] `IContextCompressor` 接口定义，支持依赖倒置
- [x] 内置 `DefaultContextCompressor`，支持 truncate / sliding-window / summarize / hybrid 四种策略
- [x] `AgentContext.compression` 存储压缩元数据，`messages` 不被修改
- [x] `buildMessages()` 根据 compression 元数据构造 LLM 视图
- [x] 每个 advance() 后自动检查并执行压缩（step / run 内部）
- [x] `runner.compress(state)` 支持手动触发
- [x] 压缩产生 `compressing` / `compressed` 流式事件
- [x] `compressor` 参数支持传配置对象（用默认实现）或传实例（自定义）
- [x] 不传 compressor 时行为与现有完全一致

---

#### Step 13: 执行回放（Replay）（⏭️ 跳过 — 暂不需要）

**跳过原因**: 核心能力已被 `runStream` 事件流 + `createSnapshot` 快照覆盖。收集 `RunStreamEvent` 数组即为录制，遍历展示即为回放。需要时再设计。

---

### Phase 4: 工程化（稳定性）

#### Step 14: 并发隔离 ✅ 已完成（设计天然保证）

**验证结果**: Runner 无状态 + AgentState 不可变的设计天然保证并发安全，无需额外代码。

**测试覆盖**: `test/unit/concurrency.test.ts`（5 个测试）

**验收标准**:
- [x] 两个 Agent 同时运行不冲突（Promise.all 并发 run，各自结果正确）
- [x] 各自的 messages 独立（同一 Runner 跑两个有不同历史消息的 state，互不污染）
- [x] 各自的 stepCount 独立（不同 maxSteps 并发执行，stepCount 各自符合预期）
- [x] 一个报错不影响另一个（一个 Runner LLM 报错，另一个正常完成）

---

#### Step 15: 错误处理
**目标**: 明确区分 LLM 错误和工具错误，上层能程序化识别错误

##### 设计原则

两种错误，两种处理策略：

| 错误类型 | 处理策略 | 理由 |
|---|---|---|
| **LLM 错误** | 上报给调用方 | LLM 挂了，无法问它怎么办 |
| **工具错误** | 传递给 LLM | LLM 可以看到错误，自己决定重试/换工具/放弃 |

##### LLM 错误：不再伪装成成功

当前问题：LLM 失败返回 `{ type: 'success', answer: 'LLM API error' }`，调用方无法区分正常回答和错误。

**StepResult 新增 error 变体**：

```typescript
// 之前
type StepResult =
  | { type: 'continue'; toolResult: unknown }
  | { type: 'done'; answer: string };

// 之后
type StepResult =
  | { type: 'continue'; toolResult: unknown }
  | { type: 'done'; answer: string }
  | { type: 'error'; error: Error };  // 新增：LLM 错误
```

**RunResult 已有 error 变体，开始使用**：

```typescript
type RunResult =
  | { type: 'success'; answer: string; totalSteps: number }
  | { type: 'max_steps'; totalSteps: number }
  | { type: 'error'; error: Error; totalSteps: number };  // 已定义，从未返回，现在启用
```

**错误流**：

```
LLM 调用失败
  → advance() catch → error phase
  → step() 返回 { type: 'error', error: Error }
  → run() 返回 { type: 'error', error: Error, totalSteps }

调用方判断：
if (result.type === 'error') {
  // 明确知道出错了，可以记录/上报/重试
} else if (result.type === 'success') {
  // 这是真正的成功
}
```

##### LLM 瞬态重试：Provider 层负责

Runner 不内置重试逻辑。LLM 的瞬态错误（429 限流、网络超时）由使用者通过包装 ILLMProvider 实现：

```typescript
// 使用者用 p-retry 包装
import pRetry from 'p-retry';

const retryProvider: ILLMProvider = {
  async call(options) {
    return pRetry(() => realProvider.call(options), {
      retries: 3,
      minTimeout: 1000,
    });
  },
  // stream 类似处理
};

const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: retryProvider,
});
```

##### 工具错误：保持现有行为

工具错误已经被正确处理——捕获异常后转为 `"Error: xxx"` 字符串作为 tool result，LLM 下一步能看到并自己决定怎么办。无需额外机制。

```
工具执行失败
  → advanceToToolResult() catch → result = "Error: xxx"
  → tool-result phase
  → step() 返回 { type: 'continue', toolResult: 'Error: xxx' }
  → run() 继续，LLM 下一步看到错误信息，自主决策
```

##### 错误流式事件

补充 `error` 事件到 StreamEvent，让 UI 能实时获知错误：

```typescript
type StreamEvent =
  | ... 现有事件
  | { type: 'error'; error: Error; context: { toolName?: string; step: number } };
```

##### 验收标准:
- [x] LLM 错误时 `step()` 返回 `{ type: 'error', error: Error }`（而非伪装成 done）
- [x] LLM 错误时 `run()` 返回 `{ type: 'error', error: Error, totalSteps }`（而非伪装成 success）
- [x] 工具错误保持现有行为：错误信息作为 tool result 传递给 LLM
- [x] 新增 `error` 流式事件，UI 可实时获知错误
- [x] LLM 瞬态重试文档说明为 ILLMProvider 层职责（不内置到 Runner）
- [x] 现有工具错误测试不受影响

**状态**: ✅ 已完成 (151 个单元测试通过，分支覆盖率 90.73%)

---

#### Step 16: 执行生命周期管理（AbortSignal）
**目标**: 支持取消正在执行的 Agent，防止内存泄漏

##### 背景

当用户关闭对话、切换场景或主动取消时，执行链路上可能存在未完成的异步操作：
- LLM 正在响应（可能数秒甚至数十秒）
- LLM 正在流式输出 token
- 工具正在执行（HTTP 请求、数据库查询、ask_human 等待人类输入）

如果这些操作的 Promise 永远不 resolve/reject，整个执行链（state、execState、runner）都无法被 GC，造成内存泄漏。

##### 需要取消的场景

| 场景 | 取消时机 | 取消方式 |
|---|---|---|
| **LLM 阻塞调用** (`llmProvider.call`) | 等待 LLM 响应期间 | reject HTTP 请求 |
| **LLM 流式接收** (`llmProvider.stream`) | 逐字输出 token 期间 | 关闭流，停止 yield |
| **工具执行** (`registry.execute`) | 工具内部 IO（fetch、ask_human 等） | 工具自行处理 signal |
| **run() 的 step 循环** | 步间 | 检查 signal，不再发起下一个 step |
| **step() 的 advance 循环** | 步间 | 检查 signal，不再发起下一个 advance |

##### 设计

使用标准 JavaScript AbortController/AbortSignal 模式。signal 从调用方传入，贯穿整个执行链：

```
调用方 (AbortController)
  │
  ▼ signal
run({ signal })
  │ ├── 步间检查 signal（while 循环每次迭代前）
  │
  ▼ signal
step({ signal })
  │ ├── 步间检查 signal（while 循环每次迭代前）
  │
  ▼ signal
advance({ signal })
  │
  ├── advanceToLLMResponse ──► llmProvider.call({ signal })
  │
  ├── streamCallingLLM ──► llmProvider.stream({ signal })
  │                          ├── 每次 yield token 前检查 signal
  │                          └── signal aborted → 停止读取流，停止 yield
  │
  └── advanceToToolResult ──► registry.execute(name, args, { signal })
```

##### 接口变更

```typescript
// 1. ILLMProvider 增加 signal
interface ILLMProvider {
  call(options: {
    model: string;
    messages: Message[];
    tools?: Tool[];
    priority?: number;
    requestTimeout?: number;
    signal?: AbortSignal;  // 新增
  }): Promise<LLMResponse>;

  stream(options: {
    model: string;
    messages: Message[];
    tools?: Tool[];
    priority?: number;
    requestTimeout?: number;
    signal?: AbortSignal;  // 新增
  }): AsyncIterable<StreamEvent>;
}

// 2. IToolRegistry.execute 增加 signal
interface IToolRegistry {
  execute(name: string, args: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  // ... 其他方法不变
}

// 3. 执行方法增加 signal 参数
// run() / runStream()
async run(state, options?: { maxSteps?: number; signal?: AbortSignal }): Promise<...>;

// step() / stepStream()
async step(state, toolRegistry?, options?: { signal?: AbortSignal }): Promise<...>;

// advance() / advanceStream()
async advance(state, execState, toolRegistry?, options?: { signal?: AbortSignal }): Promise<...>;
```

**向后兼容**: 所有 signal 参数都是 optional，不传时行为与现有完全一致。

##### 各层处理方式

```typescript
// 循环层（run / step）：步间检查
while (totalSteps < maxSteps) {
  signal?.throwIfAborted();  // 每次迭代前检查
  const { result } = await this.step(currentState, registry, { signal });
  // ...
}

// LLM 调用层：传递给 provider
const response = await this.llmProvider.call({
  model, messages, tools, signal,  // fetch 内部原生支持 AbortSignal
});

// LLM 流式层：迭代中检查
for await (const event of this.llmProvider.stream({ ..., signal })) {
  if (signal?.aborted) break;  // 停止读取
  yield event;
}

// 工具执行层：传递给 registry
result = await registry.execute(action.tool, action.arguments, { signal });

// 工具内部（如 ask_human）：自行处理
handler({ questions, context, signal });
```

##### 验收标准:
- [x] `run()` / `step()` / `advance()` 及流式版本支持 `signal` 参数
- [x] 循环层（run 的 step 循环、step 的 advance 循环）每次迭代前检查 signal
- [x] signal 传递到 `ILLMProvider.call()` 和 `ILLMProvider.stream()`
- [x] signal 传递到 `IToolRegistry.execute()`
- [x] 流式方法（`runStream` / `stepStream` / `advanceStream`）abort 后停止 yield 事件
- [x] abort 后正在执行的 Promise 正确 reject（AbortError），不泄漏
- [x] `ILLMProvider` 和 `IToolRegistry` 接口变更向后兼容（signal 为 optional）
- [x] 不传 signal 时行为与现有完全一致（零侵入）

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

**Phase 4（Step 14-16）** = 生产稳定性
- 完成后可以稳定运行多个 Agent，错误可恢复，支持取消

### 关键设计决策

1. **ReAct 为主**：Phase 1 只做 ReAct，Plan-and-Execute 后续作为策略扩展
2. **状态纯数据**：AgentState 无方法，只有数据，确保可序列化
3. **Runner 无状态**：同一 Runner 可并发执行多个 AgentState
4. **长期记忆不做**：Phase 1-2 专注对话历史的短期管理
5. **事件驱动调试**：通过钩子而非侵入式代码实现调试能力
6. **流式全覆盖**：所有执行方法都有对应的流式版本（`*Stream`）
   - `chat()` / `chatStream()`
   - `advance()` / `advanceStream()`
   - `step()` / `stepStream()`
   - `run()` / `runStream()`
7. **流式仅观察**：流式方法不改变控制流，只提供观察能力
   - 控制流仍由调用方通过 `for-await` 控制
   - 可随时 `break` 中断流式接收
   - 流式结束后仍需获取最终状态

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

**使用 `advance()` 手动控制 或 注入拦截 Registry**：

```typescript
// 方式一：使用 advance() 手动控制（精细调试场景）
let state = initialState;
while (true) {
  const { state: newState, phase, done } = await runner.advance(state, execState);
  state = newState;

  if (phase.type === 'parsed' && phase.action) {
    const confirmed = await confirmWithUser(phase.action);
    if (!confirmed) break;
  }

  if (done) break;
}

// 方式二：注入拦截 Registry（自动化场景）
class ConfirmableRegistry implements IToolRegistry {
  async execute(name: string, args: unknown) {
    if (this.needsConfirm(name)) {
      const decision = await this.confirmFn(name, args);
      if (!decision.approved) throw new Error('User rejected');
    }
    return this.inner.execute(name, args);
  }
}

// 方式三：ask_human 工具（LLM 主动请求人类输入，见 Step 11）
```

### Q3: 内部思考 vs 对外展示？

通过消息类型区分，Runner 自动处理（新状态返回）：

```typescript
interface Message {
  role: 'assistant';
  content: string;
  type: 'thought' | 'final';  // 内部思考 vs 最终答案
  visible: boolean;            // 对外可见性
}

// Runner 在执行过程中自动创建新状态
const { state: newState, result } = await runner.step(state);

// newState 中的 messages 已包含标记
// thought: visible=false
// final: visible=true

// 获取对外可见的消息（从新状态过滤）
const visibleMessages = newState.context.messages.filter(m => m.visible !== false);
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
