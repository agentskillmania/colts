# @agentskillmania/colts

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Agent framework with detailed output, step-by-step execution, and state transparency.

## Features

- **Detailed Output**: Every step of execution is logged and visible
- **State Transparency**: Full visibility into the agent's internal state
- **Step-by-Step Execution**: Clear progress tracking for long-running tasks

## Installation

```bash
pnpm add @agentskillmania/colts
```

## Usage

```typescript
import { createAgent } from '@agentskillmania/colts';

const agent = createAgent({
  name: 'my-agent',
  // ...
});

await agent.run();
```

## License

MIT
