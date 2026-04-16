---
"@agentskillmania/colts": minor
"@agentskillmania/colts-cli": minor
---

Refactor: modular architecture upgrade (M0-M5)

Core:
- Extracted `IMessageAssembler` for pluggable context engineering
- Replaced hard-coded switch-case with `IPhaseHandler` registry in execution engine
- Added `IToolSchemaFormatter` and `ISubAgentFactory` for future MCP integration
- Supported parallel tool calling via `actions[]`
- Extracted `IExecutionPolicy` for customizable stop/error/retry strategies
- Unified blocking and streaming orchestration through Effect List pattern
- Added `tools:start` / `tools:end` events for batch tool calls

CLI:
- Added interactive `AskHumanDialog` (text/number/single-select/multi-select)
- Added `ConfirmDialog` for dangerous tool confirmation
- Added `SetupWizard` for first-time configuration (3-step wizard)
- Added timeline entry windowing (200 max entries)
- Added `runner-setup.ts` to break circular dependency
