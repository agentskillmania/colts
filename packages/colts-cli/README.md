# @agentskillmania/colts-cli

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

Terminal UI (TUI) for the colts agent framework — an interactive debugging and development environment built with [ink](https://github.com/vadimdemedes/ink).

## Features

- **Split-Pane Layout**: Chat panel on the left, event stream on the right
- **Three-Level Execution Control**: `/run`, `/step`, `/advance` commands
- **Real-Time Streaming**: Live token output and event display
- **Session Persistence**: Auto-save and restore conversation history
- **Skill Integration**: `/skill <name>` to load domain-specific instructions
- **Subagent Events**: View sub-agent activity with indented display
- **Configuration Wizard**: Guided setup when no config is found

## Installation

```bash
pnpm add -g @agentskillmania/colts-cli
```

## Quick Start

```bash
# Start the TUI
colts-cli

# First time? Configure your LLM provider
# > /config llm.provider openai
# > /config llm.apiKey sk-...
# > /config llm.model gpt-4
```

## Commands

| Command | Description |
|---------|-------------|
| `/run` | Switch to run mode (auto-loop until completion) |
| `/step` | Switch to step mode (one ReAct cycle per Enter) |
| `/advance` | Switch to advance mode (one phase per Enter) |
| `/skill <name>` | Load a skill's instructions into the conversation |
| `/clear` | Clear all messages |
| `/help` | Show available commands |
| `Ctrl+C` / `Esc` | Exit the application |

## Configuration

Configuration is loaded from:

1. `./colts.yaml` (project-local)
2. `~/.agentskillmania/colts/config.yaml` (global)

Example `colts.yaml`:

```yaml
llm:
  provider: openai
  apiKey: sk-...
  model: gpt-4

agent:
  name: my-agent
  instructions: "You are a helpful assistant."

skills:
  - ./skills
  - ~/.agentskillmania/colts/skills

persistence:
  enabled: true
```

## Architecture

Built with [ink](https://github.com/vadimdemedes/ink) (React for CLI):

- **Chat Panel** (`components/chat.tsx`): Message display with role labels and streaming cursor
- **Event Panel** (`components/events.tsx`): Real-time event stream with color coding
- **Input Box** (`components/input.tsx`): Text input with mode indicator
- **Split Pane** (`components/split-pane.tsx`): Resizable split layout
- **Agent Hook** (`hooks/use-agent.ts`): Agent interaction state management
- **Events Hook** (`hooks/use-events.ts`): Event buffering with 100ms batch rendering

## License

MIT
