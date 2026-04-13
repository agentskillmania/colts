# @agentskillmania/colts

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Core ReAct agent framework for development and debugging. Provides a stateless runner, immutable state updates, three-level execution control, streaming support, context compression, skill system, and subagent delegation.

## Features

- **Stateless Runner**: A single `AgentRunner` can safely execute multiple `AgentState` instances concurrently
- **Immutable State**: All state updates use Immer — the original state is never modified
- **Three-Level Execution Control**:
  - Micro-step: `advance()` / `advanceStream()` — progress one execution phase at a time
  - Meso-step: `step()` / `stepStream()` — complete one full ReAct cycle
  - Macro-step: `run()` / `runStream()` — loop until completion or `maxSteps` exhausted
- **Streaming Support**: Real-time token output, phase transitions, tool calls, and compression events
- **Context Compression**: Built-in `DefaultContextCompressor` with strategies `truncate`, `sliding-window`, `summarize`, and `hybrid`
- **Human-in-the-Loop**: Built-in `ask_human` tool and `ConfirmableRegistry`
- **Tool System**: Zod-based parameter validation with automatic JSON Schema generation via `zodToJsonSchema`
- **Skill System**: Auto-discover and load domain-specific instructions from `SKILL.md` files; supports nested skill calling
- **Subagent System**: Delegate tasks to specialized sub-agents with independent configs, tools, and state

## Installation

```bash
pnpm add @agentskillmania/colts
```

## Quick Start

### Injection mode (recommended for production)

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

// Simple chat (single turn)
const chatResult = await runner.chat(state, 'What is 2+2?');
console.log(chatResult.response); // "4"
console.log(chatResult.tokens);   // { input: 15, output: 2 }
state = chatResult.state;

// Run until completion (auto-loop with tool execution)
const { state: finalState, result } = await runner.run(state);
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

### Quick-init mode (convenient for prototyping)

```typescript
import { AgentRunner, createAgentState, calculatorTool } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'gpt-4o',
  llm: { apiKey: 'sk-...', provider: 'openai' },
  tools: [calculatorTool],
  maxSteps: 10,
});
```

## Execution APIs

### Chat

Single-turn conversation without tool execution.

```typescript
const result = await runner.chat(state, 'Hello!', { priority: 0 });
// result: { state, response, tokens, stopReason }

for await (const chunk of runner.chatStream(state, 'Hello!')) {
  if (chunk.type === 'text') process.stdout.write(chunk.delta);
  if (chunk.type === 'done') console.log('\nTokens:', chunk.tokens);
}
```

### Run

Auto-loop `step()` until a final answer is reached or `maxSteps` is exhausted.

```typescript
const { state: finalState, result } = await runner.run(state, { maxSteps: 15 });
// result.type: 'success' | 'max_steps' | 'error'

for await (const event of runner.runStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'complete') console.log('\nDone:', event.result);
}
```

### Step

Execute exactly one ReAct cycle (preparing → calling-llm → parsing → [executing-tool] → completed).

```typescript
const { state: newState, result } = await runner.step(state);
// result.type: 'done' | 'continue' | 'error'

for await (const event of runner.stepStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'phase-change') console.log('Phase:', event.to.type);
}
```

### Advance

Fine-grained phase-by-phase execution. You manage the `ExecutionState` externally.

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

// Streaming variant
for await (const event of runner.advanceStream(state, execState)) {
  if (event.type === 'token') process.stdout.write(event.token);
}
```

## State Management

`AgentState` is pure data — serializable, immutable, and cloneable.

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

// Snapshots
const snapshot = createSnapshot(state);
const restored = restoreSnapshot(snapshot);

// Serialization
const json = serializeState(state);
state = deserializeState(json);
```

## Tool System

Register tools with Zod schemas. The runner auto-generates JSON Schemas for the LLM.

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

Built-in tools:

- `calculatorTool` — basic math evaluator
- `createAskHumanTool(handler)` — pause execution to ask a human

## Context Compression

Prevent unbounded context growth with `DefaultContextCompressor`. Messages are **never deleted** — compression only affects what is sent to the LLM.

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

Strategies:

- `truncate` / `sliding-window` — drop old messages
- `summarize` / `hybrid` — call the LLM to summarize old messages (requires `llmClient`)

## Skill System

Skills are domain-specific instruction sets loaded from `SKILL.md` files.

```typescript
import { FilesystemSkillProvider } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  skillDirectories: ['./skills', '~/.agentskillmania/colts/skills'],
});
```

`SKILL.md` format:

```markdown
---
name: code-review
description: Perform comprehensive code reviews
---

# Code Review Skill

You are a code review expert...
```

When a skill provider is configured, the runner automatically registers:
- `load_skill` — switch to a different skill
- `return_skill` — return from a nested skill call

## Subagent System

Delegate tasks to independent sub-agents.

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

The `delegate` tool is automatically registered, allowing the parent agent to invoke sub-agents.

## Runner Events

`AgentRunner` extends `EventEmitter` and emits the following events:

| Event | Payload | Description |
|-------|---------|-------------|
| `run:start` | `{ state }` | A `run()` / `runStream()` started |
| `run:end` | `{ state, result }` | Run completed |
| `step:start` | `{ state, stepNumber }` | A `step()` / `stepStream()` started |
| `step:end` | `{ state, stepNumber, result }` | Step completed |
| `advance:phase` | `{ from, to, state }` | Phase changed during `advance()` |
| `llm:tokens` | `{ tokens: string[] }` | Token batch from LLM |
| `tool:call` | `{ tool, arguments }` | Tool execution started |
| `tool:result` | `{ tool, result }` | Tool execution completed |
| `skill:load` | `{ name }` | Skill loaded |
| `compress:start` | `{ state }` | Compression started |
| `compress:end` | `{ state, summary, removedCount }` | Compression completed |
| `error` | `{ state, error, phase }` | Error occurred |

## Stream Events

Events yielded by `*Stream` methods:

| Event | Fields | Description |
|-------|--------|-------------|
| `phase-change` | `from`, `to` | Execution phase transition |
| `token` | `token` | Real-time token output |
| `tool:start` | `action` | Tool execution started |
| `tool:end` | `result` | Tool execution completed |
| `skill:loading` | `name` | Skill instructions loading |
| `skill:loaded` | `name`, `tokenCount` | Skill instructions loaded |
| `skill:start` | `name`, `task` | Skill task started |
| `skill:end` | `name`, `result` | Skill task ended |
| `subagent:start` | `name`, `task` | Sub-agent task started |
| `subagent:end` | `name`, `result` | Sub-agent task ended |
| `compressing` | — | Context compression started |
| `compressed` | `summary`, `removedCount` | Context compression completed |
| `error` | `error`, `context` | Execution error |
| `step:start` | `step`, `state` | Step started (runStream only) |
| `step:end` | `step`, `result` | Step ended (runStream only) |
| `complete` | `result` | Run completed (runStream only) |

## License

MIT
