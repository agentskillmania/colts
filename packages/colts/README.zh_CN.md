# @agentskillmania/colts

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

具有详细输出、分步执行和状态透明性的 Agent 框架。

## 特性

- **详细输出**：执行的每一步都被记录和可见
- **状态透明**：完全可见 Agent 的内部状态
- **分步执行**：清晰的长任务进度追踪

## 安装

```bash
pnpm add @agentskillmania/colts
```

## 使用

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
