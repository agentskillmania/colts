# @agentskillmania/colts-cli

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

colts Agent 框架的终端 UI（TUI）—— 基于 [Ink](https://github.com/vadimdemedes/ink) 构建的交互式调试与开发环境。

## 特性

- **单画布布局**：顶部状态栏、时间线面板和输入栏统一呈现
- **三级执行控制**：随时切换 `/run`、`/step`、`/advance` 模式
- **实时流式输出**：token 实时输出，UI 节流更新（约 50ms）
- **三级展示粒度**：`/show:compact`、`/show:detail`、`/show:verbose` 控制执行元信息的显示量
- **Session 持久化**：自动保存并恢复对话历史到 `~/.agentskillmania/colts/sessions/`
- **Skill 集成**：`/skill <name>` 加载领域指令，`/skill` 列出可用 Skill
- **Subagent 事件**：在时间线中可视化子代理活动
- **配置引导**：缺少 LLM 配置时显示设置提示与配置文件路径

## 安装

```bash
pnpm add -g @agentskillmania/colts-cli
```

## 快速开始

```bash
# 启动 TUI
colts

# 或通过 pnpm dlx
pnpm dlx @agentskillmania/colts-cli
```

如果未找到有效配置，TUI 会显示设置提示，并给出配置文件路径。

## 命令

| 命令 | 别名 | 描述 |
|---------|-------|-------------|
| `/run` | — | 切换到 **run** 模式：自动循环运行直到完成 |
| `/step` | — | 切换到 **step** 模式：每按一次 Enter 执行一个 ReAct 周期 |
| `/advance` | — | 切换到 **advance** 模式：每按一次 Enter 推进一个阶段 |
| `/skill <name> [message]` | — | 加载指定 Skill，并可附带一条初始消息 |
| `/skill` | — | 列出所有可用的 Skill |
| `/show:compact` | `/compact` | 仅显示用户消息、助手回复和运行完成结果 |
| `/show:detail` | `/detail` | 额外显示步骤边界、工具参数/结果、压缩事件 |
| `/show:verbose` | `/verbose` | 额外显示阶段转换、实时 token 和 thought |
| `/clear` | — | 清空所有时间线条目 |
| `/help` | — | 显示可用命令 |

### 全局快捷键

- **Ctrl+C**（运行中）：中断当前 Agent 执行
- **Ctrl+C**（空闲时）：退出应用

## 配置

配置文件按以下顺序加载：

1. `./colts.yaml`（项目本地）
2. `~/.agentskillmania/colts/config.yaml`（全局）

如果两者都不存在，则会在全局路径自动生成默认配置文件。

`colts.yaml` 示例：

```yaml
llm:
  provider: openai
  apiKey: sk-...
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # 可选

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

## 架构

基于 [Ink](https://github.com/vadimdemedes/ink)（终端上的 React）和 [@inkjs/ui](https://github.com/inkjs/ui) 构建：

- **`index.ts`**：入口文件 — 加载配置、创建 `AgentRunner`、渲染 TUI
- **`app.tsx`**：根 React 组件 — 在主界面与配置引导之间路由
- **`config.ts`**：使用 `@agentskillmania/settings-yaml` 加载和保存配置
- **`session.ts`**：Session 持久化 — 保存、加载、列出和删除 Agent 状态
- **`hooks/use-agent.ts`**：核心 Agent 交互 Hook — 管理时间线条目、执行模式、展示级别和流解析
- **`types/timeline.ts`**：统一的时间线条目类型，以及各展示级别下的可见性规则

## 时间线条目

TUI 将所有 Agent 活动渲染为统一的时间线。每种条目在不同展示级别下的可见性如下：

| 条目类型 | Compact | Detail | Verbose |
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
