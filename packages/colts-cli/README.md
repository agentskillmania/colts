# @agentskillmania/colts-cli

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Terminal UI (TUI) for the colts agent framework — an interactive debugging and development environment built with [Ink](https://github.com/vadimdemedes/ink).

## Features

- **Single-Canvas Layout**: Header bar, timeline panel, and input bar in one unified view
- **Three-Level Execution Control**: Switch between `/run`, `/step`, and `/advance` modes on the fly
- **Real-Time Streaming**: Live token output with throttled UI updates (~50ms)
- **Three Detail Levels**: `/show:compact`, `/show:detail`, `/show:verbose` to control how much execution metadata is displayed
- **Session Persistence**: Auto-save and restore conversation history to `~/.agentskillmania/colts/sessions/`
- **Skill Integration**: `/skill <name>` to load domain-specific instructions; `/skill` to list available skills
- **Subagent Events**: Visualize sub-agent activity in the timeline
- **Config Guidance**: Shows setup instructions when LLM configuration is missing

## Installation

```bash
pnpm add -g @agentskillmania/colts-cli
```

## Quick Start

```bash
# Start the TUI
colts

# Or via pnpm dlx
pnpm dlx @agentskillmania/colts-cli
```

If no valid configuration is found, the TUI displays a setup prompt with the config file path.

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/run` | — | Switch to **run** mode: auto-loop until completion |
| `/step` | — | Switch to **step** mode: one ReAct cycle per Enter |
| `/advance` | — | Switch to **advance** mode: one phase per Enter |
| `/skill <name> [message]` | — | Load a skill and optionally send an initial message |
| `/skill` | — | List all available skills |
| `/show:compact` | `/compact` | Show only user messages, assistant replies, and run completions |
| `/show:detail` | `/detail` | Also show step boundaries, tool args/results, and compression events |
| `/show:verbose` | `/verbose` | Also show phase transitions, real-time tokens, and thoughts |
| `/clear` | — | Clear all timeline entries |
| `/help` | — | Show available commands |

### Global shortcuts

- **Ctrl+C** (while running): Abort the current agent execution
- **Ctrl+C** (while idle): Exit the application

## Configuration

Configuration is loaded in the following order:

1. `./colts.yaml` (project-local)
2. `~/.agentskillmania/colts/config.yaml` (global)

If neither exists, a default config file is created at the global path.

Example `colts.yaml`:

```yaml
llm:
  provider: openai
  apiKey: sk-...
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # optional

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

## Architecture

Built with [Ink](https://github.com/vadimdemedes/ink) (React for terminals) and [@inkjs/ui](https://github.com/inkjs/ui):

- **`index.ts`**: Entry point — loads config, creates `AgentRunner`, renders the TUI
- **`app.tsx`**: Root React component — routes between the main TUI and the config prompt
- **`config.ts`**: Configuration loading and saving using `@agentskillmania/settings-yaml`
- **`session.ts`**: Session persistence — save, load, list, and delete agent states
- **`hooks/use-agent.ts`**: Core agent interaction hook — manages timeline entries, execution modes, detail levels, and stream parsing
- **`types/timeline.ts`**: Unified timeline entry types and visibility rules per detail level

## Timeline Entries

The TUI renders all agent activity as a unified timeline. Each entry type is visible at different detail levels:

| Entry Type | Compact | Detail | Verbose |
|------------|:-------:|:------:|:-------:|
| `user` | ✅ | ✅ | ✅ |
| `assistant` | ✅ | ✅ | ✅ |
| `tool` | ✅ | ✅ | ✅ |
| `run-complete` | ✅ | ✅ | ✅ |
| `skill` | ✅ | ✅ | ✅ |
| `subagent` | ✅ | ✅ | ✅ |
| `system` | ✅ | ✅ | ✅ |
| `error` | ✅ | ✅ | ✅ |
| `step-start` / `step-end` | ❌ | ✅ | ✅ |
| `compress` | ❌ | ✅ | ✅ |
| `phase` | ❌ | ❌ | ✅ |
| `thought` | ❌ | ❌ | ✅ |

## License

MIT
