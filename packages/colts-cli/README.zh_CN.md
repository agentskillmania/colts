# @agentskillmania/colts-cli

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

colts agent 框架的终端 UI（TUI）——基于 [ink](https://github.com/vadimdemedes/ink) 构建的交互式调试和开发环境。

## 特性

- **分屏布局**：左侧对话面板，右侧事件流面板
- **三级执行控制**：`/run`、`/step`、`/advance` 命令
- **实时流式输出**：实时 token 输出和事件显示
- **会话持久化**：自动保存和恢复对话历史
- **Skill 集成**：`/skill <name>` 加载领域专用指令
- **Subagent 事件**：查看子 agent 活动，缩进显示
- **配置引导**：无配置时显示引导信息

## 安装

```bash
pnpm add -g @agentskillmania/colts-cli
```

## 快速开始

```bash
# 启动 TUI
colts-cli

# 首次使用？配置 LLM 提供者
# > /config llm.provider openai
# > /config llm.apiKey sk-...
# > /config llm.model gpt-4
```

## 命令

| 命令 | 描述 |
|------|------|
| `/run` | 切换到运行模式（自动循环直到完成） |
| `/step` | 切换到单步模式（每次回车执行一个 ReAct 循环） |
| `/advance` | 切换到微步模式（每次回车推进一个阶段） |
| `/skill <name>` | 加载 Skill 指令到对话中 |
| `/clear` | 清空所有消息 |
| `/help` | 显示可用命令 |
| `Ctrl+C` / `Esc` | 退出应用 |

## 配置

配置文件加载顺序：

1. `./colts.yaml`（项目本地）
2. `~/.agentskillmania/colts/config.yaml`（全局）

示例 `colts.yaml`：

```yaml
llm:
  provider: openai
  apiKey: sk-...
  model: gpt-4

agent:
  name: my-agent
  instructions: "你是一个有用的助手。"

skills:
  - ./skills
  - ~/.agentskillmania/colts/skills

persistence:
  enabled: true
```

## 架构

基于 [ink](https://github.com/vadimdemedes/ink)（React for CLI）构建：

- **对话面板**（`components/chat.tsx`）：消息显示，带角色标签和流式光标
- **事件面板**（`components/events.tsx`）：实时事件流，颜色编码
- **输入框**（`components/input.tsx`）：文本输入，带模式指示器
- **分屏容器**（`components/split-pane.tsx`）：可调整的分割布局
- **Agent Hook**（`hooks/use-agent.ts`）：Agent 交互状态管理
- **Events Hook**（`hooks/use-events.ts`）：事件缓冲，100ms 批量渲染

## License

MIT
