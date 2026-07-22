# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

A stateless ReAct agent framework with three-level execution control, event-driven streaming, and pluggable context engineering. One runner instance safely serves multiple concurrent agents.

## Highlights

- **Stateless Runner** — One `AgentRunner` instance, multiple `AgentState` instances. Thread-safe by design.
- **Three-Level Execution** — `run()` (auto-loop), `step()` (one ReAct cycle), `advance()` (one phase).
- **Event-Driven Observability** — `AgentRunner` extends `EventEmitter`. All execution events (tokens, thinking, tool calls, phase changes, sub-agent activity) are emitted via `runner.on(...)`. Tokens are streamed internally through `llmProvider.stream()` and emitted to the EventEmitter.
- **Thinking / Reasoning** — Native thinking (Claude-style) and prompt-level thinking (`<think/>` tags). Configurable per request.
- **Skill System** — Runtime skill loading from `SKILL.md` files. Supports nested skill calls with `load_skill` / `return_skill`.
- **Subagent Delegation** — Delegate tasks to specialized sub-agents with independent configs, tools, state, and optional timeout. Sub-agent events bubble up to the parent runner's EventEmitter for real-time visibility.
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

// Stream tokens to the console via the EventEmitter
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('complete', (e) => console.log('\nDone:', e.result.type));

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

### Run — auto-loop until final answer or maxSteps

```typescript
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('complete', (e) => console.log('Done:', e.result));

const { state: finalState, result } = await runner.run(state, { maxSteps: 15 });
// result.type: 'success' | 'max_steps' | 'error' | 'abort'
```

### Step — one ReAct cycle

```typescript
const { state: newState, result } = await runner.step(state);
// result.type: 'done' | 'continue' | 'error'

runner.on('phase-change', (e) => console.log('Phase:', e.to.type));
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

## Event System

`AgentRunner` extends `EventEmitter` (from `eventemitter3`). All execution events flow through a single channel — there are no separate streaming APIs. Subscribe with `runner.on(event, handler)`:

```typescript
runner.on('run:start', (e) => console.log('Run started'));
runner.on('step:start', (e) => console.log(`Step ${e.step}`));
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('thinking', (e) => process.stderr.write(e.content));
runner.on('tool:start', (e) => console.log('Tool:', e.action.name));
runner.on('tool:end', (e) => console.log('Tool result:', e.result));
runner.on('phase-change', (e) => console.log(`${e.from.type} → ${e.to.type}`));
runner.on('compressing', () => console.log('Compressing context...'));
runner.on('complete', (e) => console.log('Run result:', e.result.type));
runner.on('error', (e) => console.error('Error:', e.error));
```

Key event groups: lifecycle (`run:start`, `run:end`, `step:start`, `step:end`, `complete`), token streaming (`token`, `thinking`), tools (`tool:start`, `tool:end`, `tools:start`, `tools:end`), context compression (`compressing`, `compressed`), LLM calls (`llm:request`, `llm:response`), and skills (`skill:start`, `skill:end`).

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

Delegate tasks to specialized sub-agents. Each sub-agent has independent instructions, tools, state, an optional step limit, and an optional timeout:

```typescript
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,
  subAgents: [{
    name: 'researcher',
    description: 'Research specialist',
    config: { name: 'researcher', instructions: 'Research topics thoroughly.', tools: [] },
    maxSteps: 5,
    timeout: 60_000, // ms — sub-agent is aborted if exceeded
    // Tool & skill inheritance (default true):
    inheritParentTools: true,   // copies every tool from the parent registry
                                // (delegate and load_skill are filtered out to
                                // avoid recursion and double-registration)
    inheritParentSkills: true,  // forwards the parent's skillProvider so the
                                // sub-agent can call load_skill
  }],
});
```

By default a sub-agent inherits the parent runner's full tool set and skill provider, so it can read files, run shell, search the web, and load skills without you redeclaring every tool per agent. Set either flag to `false` to opt out — the sub-agent then only sees the tools explicitly listed in `config.tools`.

The `delegate` tool is auto-registered, allowing the parent agent to invoke sub-agents. The tool returns a `DelegateResult` discriminated union (`status: 'success' | 'error' | 'max_steps' | 'abort' | 'timeout'`) so the parent can branch on outcome.

### Sub-agent event bubbling

Sub-agent events bubble up to the parent runner's EventEmitter with a `subagent:` prefix, so frontends can observe sub-agent work in real time:

```typescript
runner.on('subagent:start', (e) => console.log(`[${e.subtaskId}] delegated to ${e.name}: ${e.task}`));
runner.on('subagent:token', (e) => process.stdout.write(e.token)); // live sub-agent text
runner.on('subagent:thinking', (e) => process.stderr.write(e.content));
runner.on('subagent:tool:start', (e) => console.log('Sub-agent tool:', (e.action as { name?: string })?.name));
runner.on('subagent:tool:end', (e) => console.log('Sub-agent tool result:', e.result));
runner.on('subagent:end', (e) => console.log(`[${e.subtaskId}] finished:`, e.result.status));
```

Each event carries `subtaskId` and `subagentName` for routing when multiple sub-agents run.

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
