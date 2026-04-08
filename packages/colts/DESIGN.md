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
- `streaming` 不是一个独立的 Phase。流式是 `calling-llm` 阶段内部的**读取方式**，不是状态机的节点
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
- [ ] `advance()` 每次推进一个自然阶段，返回当前 phase
- [ ] `advance()` 在产生实质变更的 phase（llm-response, tool-result, completed）用 Immer 返回新 AgentState
- [ ] `advance()` 在过渡 phase 返回原 state（同一引用）
- [ ] 可在任意 phase 暂停，此时 AgentState 反映到该 phase 为止的所有变更
- [ ] `step()` 内部由多个 `advance()` 组成，state 在 advance 过程中已逐步更新
- [ ] `stepStream()` 复用 `advance()` 核心逻辑，仅在 `calling-llm` 阶段注入流式读取
- [ ] `stepStream()` 只调用一次 LLM（不重复调用）
- [ ] `advanceStream()` 不引入 `streaming` 作为独立 phase
- [ ] 所有方法返回的 AgentState 遵循不可变原则（新 state 由 Immer produce 创建）

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

#### Step 6: Runner 配置化
**目标**: Runner 可配置，支持不同策略，所有方法返回不可变状态

```typescript
import { z } from 'zod';
import { Tool } from './types';

interface RunnerConfig {
  llm: LLMClient;
  tools?: Tool<z.ZodTypeAny>[];  // Zod 定义的工具列表
  maxSteps?: number;             // 默认 10
  timeout?: number;              // 单步超时（毫秒）
  systemPrompt?: string;         // 覆盖默认 ReAct 提示词
  hooks?: RunnerHooks;           // 生命周期钩子（仅观察）
}

class AgentRunner {
  constructor(config: RunnerConfig);
  
  // 动态注册/注销工具（运行时扩展）
  registerTool<T extends z.ZodTypeAny>(tool: Tool<T>): void;
  unregisterTool(name: string): void;
  
  // 所有执行方法都返回 { state, ... }，state 为不可变新状态
  // - advance() / advanceStream()
  // - step() / stepStream()
  // - run() / runStream()
  // - chat() / chatStream()
  // - runInteractive()
}
```

**验收标准**:
- [ ] 可在构造时传入工具列表
- [ ] 支持运行时动态注册/注销工具
- [ ] 可配置 maxSteps、timeout、systemPrompt
- [ ] 所有执行方法返回 `{ state, ... }` 结构
- [ ] 返回的 state 是新的不可变对象（Immer 创建）
- [ ] 原 state 保持不变

---

### Phase 2: 调试基础（可见性）

#### Step 7: 生命周期钩子
**目标**: 外部能观察到执行过程

```typescript
interface RunnerHooks {
  // 注意：钩子接收的是当前 state（只读），修改不会生效
  // 如果需要干预，使用 advance() 手动控制或返回特定值
  beforeStep?: (state: AgentState, step: number) => void | Promise<void>;
  afterStep?: (state: AgentState, result: StepResult) => void | Promise<void>;
  onToolCall?: (state: AgentState, call: ToolCall) => void | Promise<void>;
  onToolResult?: (state: AgentState, result: ToolResult) => void | Promise<void>;
}

class AgentRunner {
  constructor(config: RunnerConfig & { hooks?: RunnerHooks });
}
```

**重要说明**：
- 钩子仅用于**观察**，不能修改 state
- state 参数是**新的不可变状态**（每次调用都是最新）
- 需要干预执行（如暂停、修改）请使用 `advance()` 手动控制

**验收标准**:
- [ ] beforeStep 在每次 LLM 调用前触发，传入当前 state
- [ ] afterStep 在每次工具执行后触发，传入新的 state 和 result
- [ ] 钩子可以异步（支持 await）
- [ ] 钩子抛错可选是否中断执行

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
// 使用方式（外部控制循环，不可变数据）
const runner = new AgentRunner(config);
let state = createAgentState({...});

// step 返回新状态，需要显式接收
const result1 = await runner.step(state);
state = result1.state;     // 更新 state 引用
inspect(state);            // 查看新状态

const result2 = await runner.step(state);
state = result2.state;     // 再次更新
inspect(state);

// 或者使用 advance 进行更细粒度控制
const advanceResult = await runner.advance(state);
state = advanceResult.state;  // 更新引用
console.log(advanceResult.phase.type);  // 查看当前阶段
```

**关键要点**:
- 每次调用都返回 `{ state, ... }`，必须显式更新 state 引用
- 原 state 保持不变，可用于对比或回退
- 可随时停止（不再继续调用）

**验收标准**:
- [ ] 每次 step/advance 返回新的 state
- [ ] 需要显式更新 state 引用才能继续
- [ ] 可以查看和对比新旧状态
- [ ] 可以随时停止执行

---

### Phase 3: 调试增强（干预能力）

#### Step 10: 工具 Mock 系统
**目标**: 开发时工具可 Mock，不影响不可变数据设计

```typescript
interface ToolMock {
  returnValue?: unknown;
  delay?: number;         // 模拟延迟（ms）
  error?: string;         // 模拟错误
}

class AgentRunner {
  // Mock 配置是 Runner 级别的，不修改 AgentState
  enableMockMode(): void;
  disableMockMode(): void;
  mockTool(name: string, mock: ToolMock): void;
  unmockTool(name: string): void;
  
  // 使用方式：创建带 Mock 的 Runner，执行返回正常状态结构
  const runner = new AgentRunner({ llm, hooks });
  runner.mockTool('api', { returnValue: 'mocked' });
  
  const { state: newState, result } = await runner.step(state);
  // newState 中的 tool result 是 mocked 值，但 state 本身结构不变
}
```

**验收标准**:
- [ ] Mock 模式下，指定工具返回预设值
- [ ] 未 Mock 的工具正常执行
- [ ] 可动态切换 Mock/真实模式
- [ ] Mock 支持延迟模拟
- [ ] Mock 不影响状态不可变性（只是改变了 tool 执行结果）

---

#### Step 11: 人机协作暂停点
**目标**: 能在关键节点暂停等用户输入

```typescript
interface PausePoint {
  type: 'before-tool' | 'before-completion';
  state: AgentState;     // 当前状态（不可变）
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
  }): Promise<{
    state: AgentState;    // 最终状态
    result: RunResult;
  }>;
}
```

**重要说明**：
- `point.state` 是当前状态的**快照**（不可变）
- 用户选择 resume 或 abort 后，runInteractive 返回最终状态
- 如果要修改参数后继续，使用 `resume(newArgs)`

**验收标准**:
- [ ] 工具调用前可暂停，传入当前 state
- [ ] 用户可输入后继续，返回最终 state
- [ ] 用户可中止执行，返回当前 state
- [ ] 暂停时状态不丢失（state 始终不可变）

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

**钩子仅观察，控制用 `advance` 或 `runInteractive`**：

```typescript
// 钩子：仅观察，无法修改执行流程
const runner = new AgentRunner({
  hooks: {
    onToolCall: (state, call) => {
      console.log('准备调用:', call); // 只能观察记录
    }
  }
});

// 方式一：使用 advance() 手动控制
let state = initialState;
while (true) {
  const { state: newState, phase, done } = await runner.advance(state);
  state = newState;
  
  if (phase.type === 'parsed' && phase.action) {
    // 在此暂停，询问用户
    const confirmed = await confirmWithUser(phase.action);
    if (!confirmed) {
      // 修改 state 或中止
      break;
    }
  }
  
  if (done) break;
}

// 方式二：runInteractive（回调方式）
await runner.runInteractive(initialState, {
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
