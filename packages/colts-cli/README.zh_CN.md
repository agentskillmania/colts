# @agentskillmania/colts-cli

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts-cli.svg)](https://www.npmjs.com/package/@agentskillmania/colts-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

colts Agent 框架的终端交互界面。基于 [Ink](https://github.com/vadimdemedes/ink) 构建的对话式 AI Agent 开发调试工具。

## 特色

- **实时流式输出** — token 实时显示，UI 节流更新（约 50ms）
- **三级执行控制** — 随时切换 `/run`、`/step`、`/advance` 模式
- **Skill 系统** — 运行时通过 `/skill <name>` 动态加载领域指令
- **会话持久化** — 自动保存并恢复对话历史到 `~/.agentskillmania/colts/sessions/`
- **三级展示粒度** — `/compact`、`/detail`、`/verbose` 控制信息显示量
- **工具确认** — 通过 `confirmTools` 配置对危险工具要求人工确认

## 安装

```bash
pnpm add -g @agentskillmania/colts-cli
```

## 快速开始

```bash
# 启动 TUI
colts

# 不安装直接运行
pnpm dlx @agentskillmania/colts-cli
```

首次启动会显示配置引导，按提示创建配置文件即可开始对话。

## 使用流程

1. **配置** — 在项目目录创建 `colts.yaml`，或在 `~/.agentskillmania/colts/` 创建全局配置
2. **启动** — 运行 `colts` 进入终端界面
3. **对话** — 输入消息按回车。默认是 **run** 模式（自动循环）
4. **切换模式** — `/step` 每次执行一个 ReAct 周期，`/advance` 每次推进一个阶段
5. **加载 Skill** — `/skill poet` 切换到特定领域的技能模式
6. **调整展示** — `/verbose` 显示阶段转换和思考过程，`/compact` 只显示关键信息

## 命令

| 命令 | 描述 |
|---------|-------------|
| `/run` | 自动循环运行直到完成（默认模式） |
| `/step` | 每次执行一个 ReAct 周期 |
| `/advance` | 每次推进一个执行阶段 |
| `/skill <name> [message]` | 加载指定 Skill，可附带初始消息 |
| `/skill` | 列出所有可用的 Skill |
| `/compact` | 仅显示消息、工具结果和完成状态 |
| `/detail` | 额外显示步骤边界、工具参数/结果、压缩事件 |
| `/verbose` | 额外显示阶段转换、推理过程、LLM 请求/响应 |
| `/clear` | 清空所有时间线条目 |
| `/help` | 显示可用命令 |

**快捷键：** 执行中 Ctrl+C 中止，空闲时 Ctrl+C 退出。

## 配置

配置文件搜索顺序：

1. `./colts.yaml`（项目本地）
2. `~/.agentskillmania/colts/config.yaml`（全局）

最简配置：

```yaml
llm:
  provider: openai
  apiKey: your-api-key
  model: glm-4
  baseUrl: https://open.bigmodel.cn/api/coding/paas/v4
```

完整配置：

```yaml
llm:
  provider: openai
  apiKey: your-api-key
  model: glm-4
  baseUrl: https://open.bigmodel.cn/api/coding/paas/v4  # 可选，兼容端点
  thinkingEnabled: true                    # 原生推理（Claude 类模型）
  enablePromptThinking: true               # 提示词级推理（<think/> 标签）

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
