# @agentskillmania/colts

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Agent framework with detailed output, step-by-step execution, and state transparency.

## Features

- **Stateless Runner**: One runner instance can concurrently execute multiple AgentState instances
- **Immutable State**: All state updates via Immer, original state never modified
- **Three-Level Execution Control**: Micro-step (`advance`), meso-step (`step`), macro-step (`run`)
- **Streaming Support**: Real-time token output and phase observation via `*Stream` methods
- **Context Compression**: Built-in strategies (truncate, sliding-window, summarize, hybrid)
- **Human-in-the-Loop**: Built-in `ask_human` tool and `ConfirmableRegistry`
- **AbortSignal**: Standard cancellation support throughout the execution chain
- **Tool System**: Zod-based parameter validation with automatic JSON Schema generation

## Installation

```bash
pnpm add @agentskillmania/colts
```

## Quick Start

```typescript
import { AgentRunner, createAgentState } from '@agentskillmania/colts';

// Create runner (injection mode)
const runner = new AgentRunner({
  model: 'gpt-4',
  llmClient: myLLMClient,
  systemPrompt: 'You are a helpful assistant.',
});

// Create initial state
let state = createAgentState({
  name: 'my-agent',
  instructions: 'You help users with calculations.',
});

// Simple chat
const chatResult = await runner.chat(state, 'What is 2+2?');
console.log(chatResult.response); // "4"
state = chatResult.state;

// Run until completion (auto-loop with tool execution)
const { state: finalState, result } = await runner.run(state);
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

## Quick Init Mode

```typescript
const runner = new AgentRunner({
  model: 'gpt-4',
  llm: { apiKey: 'sk-...', provider: 'openai' },
  tools: [calculatorTool],
  maxSteps: 10,
});
```

## Step-by-Step Execution

```typescript
// One ReAct cycle
const { state: newState, result } = await runner.step(state);
if (result.type === 'done') console.log('Answer:', result.answer);
if (result.type === 'continue') console.log('Tool result:', result.toolResult);

// Phase-by-phase control
const execState = createExecutionState();
while (true) {
  const { state: s, phase, done } = await runner.advance(state, execState);
  state = s;
  console.log('Phase:', phase.type);
  if (done) break;
}
```

## Streaming

```typescript
// Real-time token output
for await (const event of runner.runStream(state)) {
  if (event.type === 'token') process.stdout.write(event.token);
  if (event.type === 'complete') console.log('\nDone:', event.result);
}
```

## License

MIT
