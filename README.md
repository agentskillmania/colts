# @agentskillmania/colts

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Monorepo for agent framework and utilities.

## Packages

| Package | Description |
|---------|-------------|
| [@agentskillmania/colts](./packages/colts/) | Agent framework with detailed output, step-by-step execution, and state transparency |
| [@agentskillmania/colts-cli](./packages/colts-cli/) | Terminal UI (TUI) for interactive agent debugging and development |
| [@agentskillmania/llm-client](./packages/llm-client/) | Unified LLM client with multi-provider support |
| [@agentskillmania/settings-yaml](./packages/settings-yaml/) | YAML configuration file reader |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting
pnpm lint

# Format code
pnpm format
```

## License

MIT
