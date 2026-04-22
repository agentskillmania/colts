# @agentskillmania/colts-cli

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts-cli.svg)](https://www.npmjs.com/package/@agentskillmania/colts-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Terminal UI for the colts agent framework. An interactive chat-based tool for building, debugging, and running AI agents in the terminal. Built with [Ink](https://github.com/vadimdemedes/ink).

## Highlights

- **Real-Time Streaming** — Live token output with throttled UI updates (~50ms)
- **Three-Level Execution** — Switch between `/run`, `/step`, and `/advance` modes on the fly
- **Skill System** — Load domain-specific instructions at runtime with `/skill <name>`
- **Session Persistence** — Auto-save and restore conversations to `~/.agentskillmania/colts/sessions/`
- **Three Detail Levels** — `/compact`, `/detail`, `/verbose` to control output verbosity
- **Tool Confirmation** — Require human approval for dangerous tools via `confirmTools` config

## Installation

```bash
pnpm add -g @agentskillmania/colts-cli
```

## Quick Start

```bash
# Start the TUI
colts

# Or run without installing
pnpm dlx @agentskillmania/colts-cli
```

On first launch, you'll see a setup prompt with the config file path. Create the config and start chatting.

## Usage Flow

1. **Configure** — Create `colts.yaml` in your project or `~/.agentskillmania/colts/config.yaml`
2. **Start** — Run `colts` to launch the TUI
3. **Chat** — Type a message and press Enter. By default you're in **run** mode (auto-loop)
4. **Switch modes** — Use `/step` to advance one ReAct cycle at a time, or `/advance` for phase-by-phase control
5. **Load skills** — Use `/skill poet` to switch the agent into a specific domain mode
6. **Adjust detail** — `/verbose` to see phase transitions and thinking, `/compact` to hide them

## Commands

| Command | Description |
|---------|-------------|
| `/run` | Auto-loop until completion (default mode) |
| `/step` | One ReAct cycle per message |
| `/advance` | One execution phase per message |
| `/skill <name> [message]` | Load a skill and optionally send an initial message |
| `/skill` | List all available skills |
| `/compact` | Show only messages, tool results, and completions |
| `/detail` | Also show step boundaries, tool args/results, compression |
| `/verbose` | Also show phase transitions, thinking, and LLM request/response |
| `/clear` | Clear all timeline entries |
| `/help` | Show available commands |

**Keyboard shortcuts:** Ctrl+C during execution to abort, Ctrl+C when idle to exit.

## Configuration

Config file search order:

1. `./colts.yaml` (project-local)
2. `~/.agentskillmania/colts/config.yaml` (global)

Minimal config:

```yaml
llm:
  provider: openai
  apiKey: sk-...
  model: gpt-4o
```

Full config with all options:

```yaml
llm:
  provider: openai
  apiKey: sk-...
  model: gpt-4o
  baseUrl: https://api.openai.com/v1    # optional, for compatible endpoints
  thinkingEnabled: true                  # native reasoning (Claude-style models)
  enablePromptThinking: true             # prompt-level thinking (<think/> tags)

agent:
  name: my-agent
  instructions: |
    You are a helpful assistant.
    Use available tools when needed.

maxSteps: 20
requestTimeout: 1800000

skills:
  - ./skills
  - ~/.agentskillmania/colts/skills

confirmTools:
  - delete_file
  - execute_command

subAgents:
  - name: researcher
    description: Research specialist
    config:
      name: researcher
      instructions: Research topics thoroughly.
      tools: []
    maxSteps: 5
    allowDelegation: false
```

## License

MIT
