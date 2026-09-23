# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/agentskillmania/colts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agentskillmania/colts/actions/workflows/ci.yml)
[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

**Colts** is a pnpm-based TypeScript monorepo providing a ReAct agent framework, unified LLM client, and YAML configuration management for the `@agentskillmania` ecosystem.

## Packages

| Package                                                       | Description                                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@agentskillmania/colts`](./packages/colts/)                 | Core ReAct agent framework — stateless runner, immutable state, three-level execution control, event-driven architecture, context compression, skills, and subagents |
| [`@agentskillmania/llm-client`](./packages/llm-client/)       | Unified LLM client with multi-provider support, three-level concurrency control, priority queuing, and token tracking                                                |
| [`@agentskillmania/settings-yaml`](./packages/settings-yaml/) | YAML configuration management library with deep merge, default value fallback, and runtime overrides                                                                 |

## Installation

```bash
# Clone the repository
git clone https://gitee.com/agentskillmania/colts.git
cd colts

# Install dependencies (pnpm is enforced)
pnpm install
```

## Usage

```typescript
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/colts/llm'; // built-in LLM entry (optional)

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient: LLMClient.quickInit({
    providers: [{ name: 'openai', apiKey, models: [{ modelId: 'gpt-4o' }] }],
  }),
});

let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, '你好');
const { result } = await runner.run(state);
```

Full API (three-level execution control, tools, skills, events, state management) lives in the [colts package README](./packages/colts/README.md).

### Layering: platform-neutral core, opt-in backends

The main entry (`@agentskillmania/colts`) is platform-neutral — it has no `node:` imports and no LLM runtime bundled:

| Capability            | Main entry  | Opt-in entry                                                                                                      |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Built-in LLM client   | not bundled | `@agentskillmania/colts/llm` (re-exports `LLMClient`; resolves llm-client + its pi-ai adapter only when imported) |
| Node skill filesystem | not bundled | `@agentskillmania/colts/skills/node-fs-ops` (`nodeFsOps`)                                                         |

Injecting your own `ILLMProvider` (e.g. a browser-native fetch implementation) or your own `SkillFsOps` (e.g. OPFS-backed) requires no casts — all interface types (`Message`, `LLMTool`, `StreamEvent`, `SkillFsOps`) are first-class in this monorepo and platform-neutral.

### Skills

Skills (`SKILL.md` instruction sets) load through an injectable `ISkillProvider` with a platform-neutral `SkillFsOps` backend — full usage (injection pattern, Node/browser backends, `skillDirs` shorthand) lives in the [colts package README](./packages/colts/README.md#skill-system).

### Events

The runner is an `EventEmitter` (token / thinking / tool / phase-change / skill / subagent events) — see the [colts package README](./packages/colts/README.md#events).

## Release notes

### 0.5.0 (current alpha: `0.5.0-alpha.x`, `npm i @agentskillmania/colts@alpha`)

New capabilities:

- **Per-turn usage** — every assistant message carries `usage` (`TurnUsage`: input/output/cache tokens + duration) on the last message of each turn.
- **HITL durability** — `context.pendingInterrupts` persists unanswered human questions; waiting-human results carry the full `requests: HumanRequest[]` array; answering retargets the `tool_call_id` to the model's action id.
- **Prefix-cache–friendly history** — deterministic tool/skill ordering; time context moved to a tail `<system-reminder>` line instead of the system-prompt head; compression markers and `coveredMessages` on the `compressed` event.
- **Multimodal input declarations** — models declare `input: ["text","image"]`; image-carrying requests to undeclared models are rejected client-side with `LLMClientValidationError`.
- **Named limit constants** — `DEFAULT_REQUEST_TIMEOUT_MS`, `DEFAULT_RUNNER_MAX_STEPS`, `RUN_HARD_LIMIT`.

Breaking changes (full list in [CHANGELOG](./CHANGELOG.md)):

1. `HitlMiddlewareOptions.askHumanToolName` removed (ask_human suspension is now signalled by the tool itself).
2. `AskHumanHandler` return type widened to `HumanResponse | AskSuspendSignal` (backwards-compatible superset).
3. waiting-human `Phase`/`StepResult`/`RunResult` now require `requests: HumanRequest[]` (constructors must pass it; readers stay compatible).
4. `respond()` throws on a known-type request/response mismatch instead of silently no-op'ing.
5. llm-client rejects image requests for models that do not declare image input.

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

## Release Notes

### 0.5.1 (llm-client only, patch)

- **Streaming timeout fix** — `requestTimeout` was only enforced on `call()`; the streaming path (`streamWithRetry`) never consumed it — a hung stream never resolved and the caller's turn stayed busy forever (manual stop was the only way out). Connection and per-event iteration now share one total-duration deadline; on expiry an `error` event is emitted with the same semantics as `call()`. Upgrade: `npm i @agentskillmania/llm-client@^0.5.1`.
