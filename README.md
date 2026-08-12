# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/agentskillmania/colts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agentskillmania/colts/actions/workflows/ci.yml)
[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

**Colts** is a pnpm-based TypeScript monorepo providing a ReAct agent framework, unified LLM client, and YAML configuration management for the `@agentskillmania` ecosystem.

## Packages

| Package | Description |
|---------|-------------|
| [`@agentskillmania/colts`](./packages/colts/) | Core ReAct agent framework — stateless runner, immutable state, three-level execution control, event-driven architecture, context compression, skills, and subagents |
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

## Usage

```typescript
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';

// 1. Create the runner (llmClient: any ILLMProvider)
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,              // your ILLMProvider implementation
  tools: [],              // ColtsTool[]
  systemPrompt: 'You are a helpful assistant.',
});

// 2. Create state, add a user message, and run
let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, '你好');
const { state: finalState, result } = await runner.run(state);

// 3. The result is a discriminated union
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

### Skills

Skills are directories containing a `SKILL.md` (YAML frontmatter + instructions). The `FilesystemSkillProvider` scans skill directories through a `SkillFsOps` abstraction:

- **Node**: register the default backend once — `setDefaultSkillFsOps(nodeFsOps)` — then `new FilesystemSkillProvider(dirs)` just works
- **Browser**: inject an OPFS-backed `SkillFsOps` (this module never imports `node:` modules, so it runs anywhere)

```typescript
import { FilesystemSkillProvider } from '@agentskillmania/colts';
// Node: setDefaultSkillFsOps(nodeFsOps) once at startup
const provider = new FilesystemSkillProvider(['./skills']);
const manifests = await provider.listSkills();
```

### Events

The runner is an `EventEmitter`. Subscribe before calling `run()`:

```typescript
runner.on('step:start', ({ step }) => console.log('step', step));
runner.on('token', ({ token }) => process.stdout.write(token));
runner.on('tool:start', ({ action }) => console.log('tool', action.tool));
runner.on('llm:request', ({ model }) => console.log('llm call:', model));
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
colts ──────depends──► llm-client
settings-yaml ───────► (no internal deps)
llm-client ──────────► (no internal deps)
```

## Requirements

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0 (enforced via `preinstall` script)

## License

MIT
