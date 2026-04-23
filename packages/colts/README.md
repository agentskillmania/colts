# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

A stateless ReAct agent framework with streaming-first APIs, three-level execution control, and pluggable context engineering. One runner instance safely serves multiple concurrent agents.

## Highlights

- **Stateless Runner** — One `AgentRunner` instance, multiple `AgentState` instances. Thread-safe by design.
- **Three-Level Execution** — `run()` (auto-loop), `step()` (one ReAct cycle), `advance()` (one phase). All with streaming variants.
- **Streaming-First** — Every execution API has an `AsyncIterable` counterpart: `runStream`, `stepStream`, `advanceStream`, `chatStream`.
- **Thinking / Reasoning** — Native thinking (Claude-style) and prompt-level thinking (`<think/>` tags). Configurable per request.
- **Skill System** — Runtime skill loading from `SKILL.md` files. Supports nested skill calls with `load_skill` / `return_skill`.
- **Subagent Delegation** — Delegate tasks to specialized sub-agents with independent configs, tools, and state.
- **Context Compression** — Two strategies (`truncate`, `summarize`). Messages are never deleted.
- **Pluggable Message Assembly** — `IMessageAssembler` interface for custom RAG, memory, or prompt strategies without forking the runner.
- **Tool System** — Zod-based parameter validation with automatic JSON Schema generation.

## Installation

```bash
pnpm add @agentskillmania/colts
```

## Quick Start

```typescript
import { AgentRunner, createAgentState, calculatorTool } from '@agentskillmania/colts';

const runner = new AgentRunner({
  model: 'gpt-4o',
  llm: { apiKey: 'sk-...', provider: 'openai' },
  tools: [calculatorTool],
  maxSteps: 10,
});

let state = createAgentState({
  name: 'my-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
});

// Auto-loop until final answer or maxSteps reached
const { result } = await runner.run(state);
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

For production use, inject pre-configured dependencies:

```typescript
import { AgentRunner, ToolRegistry } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/llm-client';

const llmClient = new LLMClient();
llmClient.registerProvider({ name: 'openai', maxConcurrency: 10 });
llmClient.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  models: [{ modelId: 'gpt-4o' }],
});

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  systemPrompt: 'You are a helpful assistant.',
});
```

## Core APIs

### Chat — single turn, no tool execution

```typescript
const { state: newState, response } = await runner.chat(state, 'Hello!');

// Streaming
for await (const chunk of runner.chatStream(state, 'Hello!')) {
  if (chunk.type === 'text') process.stdout.write(chunk.delta);
}
```

### Run — auto-loop until final answer or maxSteps

```typescript
const { state: finalState, result } = await runner.run(state, { maxSteps: 15 });
// result.type: 'success' | 'max_steps' | 'error'

// Streaming
for await (const event of runner.runStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'complete') console.log('Done:', event.result);
}
```

### Step — one ReAct cycle

```typescript
const { state: newState, result } = await runner.step(state);
// result.type: 'done' | 'continue' | 'error'

for await (const event of runner.stepStream(state)) {
  if (event.type === 'phase-change') console.log('Phase:', event.to.type);
}
```

### Advance — fine-grained phase-by-phase control

```typescript
import { createExecutionState, isTerminalPhase } from '@agentskillmania/colts';

const execState = createExecutionState();
while (!isTerminalPhase(execState.phase)) {
  const result = await runner.advance(state, execState);
  state = result.state;
}
```

## Tool System

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

Built-in tools: `calculatorTool`, `createAskHumanTool(handler)`.

Use `ConfirmableRegistry` to require human approval for dangerous tools.

## Thinking / Reasoning Mode

Two modes for LLM reasoning:

**Native thinking** — for models with built-in reasoning (e.g. Claude):

```typescript
const runner = new AgentRunner({
  model: 'claude-sonnet-4-5-20250514',
  llmClient,
  thinkingEnabled: true,
});
```

**Prompt-level thinking** — injects "think step by step" guidance and extracts `<think/>` tags from responses:

```typescript
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  enablePromptThinking: true,
});
```

## Skill System

Skills are domain-specific instructions loaded from `SKILL.md` files:

```typescript
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

The runner auto-registers `load_skill` and `return_skill` tools for runtime skill switching and nested skill calls.

## Context Compression

Prevent unbounded context growth. Messages are **never deleted** — compression only affects what is sent to the LLM.

```typescript
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  compressor: {
    strategy: 'truncate',
    threshold: 50,
    thresholdType: 'message-count',
    keepRecent: 10,
  },
});
```

Strategies: `truncate`, `summarize`. The `summarize` strategy calls the LLM to generate summaries. You can also set `summaryModel` or `summaryProvider` to use a dedicated model for summarization.

## Subagent System

```typescript
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  subAgents: [{
    name: 'researcher',
    description: 'Research specialist',
    config: { name: 'researcher', instructions: 'Research topics thoroughly.', tools: [] },
    maxSteps: 5,
  }],
});
```

The `delegate` tool is auto-registered, allowing the parent agent to invoke sub-agents.

## State Management

`AgentState` is pure data — serializable, immutable, and cloneable.

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
