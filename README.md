# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/agentskillmania/colts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agentskillmania/colts/actions/workflows/ci.yml)
[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

**Colts** is a pnpm-based TypeScript monorepo providing a ReAct agent framework, unified LLM client, YAML configuration management, and an interactive terminal UI for the `@agentskillmania` ecosystem.

## Packages

| Package | Description |
|---------|-------------|
| [`@agentskillmania/colts`](./packages/colts/) | Core ReAct agent framework — stateless runner, immutable state, three-level execution control, streaming, context compression, skills, and subagents |
| [`@agentskillmania/colts-cli`](./packages/colts-cli/) | Terminal UI application built with Ink — interactive debugging and development environment |
| [`@agentskillmania/llm-client`](./packages/llm-client/) | Unified LLM client with multi-provider support, three-level concurrency control, priority queuing, and token tracking |
| [`@agentskillmania/settings-yaml`](./packages/settings-yaml/) | YAML configuration management library with deep merge, default value fallback, and runtime overrides |

## Installation

```bash
# Clone the repository
git clone https://github.com/agentskillmania/colts.git
cd colts

# Install dependencies (pnpm is enforced)
pnpm install
```

## Development

```bash
# Build all packages
pnpm build

# Watch mode
pnpm dev

# Run all tests
pnpm test

# Run only unit tests
pnpm test:unit

# Run only integration tests
pnpm test:intg

# Generate coverage report
pnpm test:coverage

# Lint
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check
```

## Architecture

```
colts-cli ──depends──► colts, settings-yaml
colts ──────depends──► llm-client
settings-yaml ───────► (no internal deps)
llm-client ──────────► (no internal deps)
```

## Requirements

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0 (enforced via `preinstall` script)

## License

MIT
