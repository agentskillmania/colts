# @agentskillmania/colts

[![CI](https://github.com/agentskillmania/colts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agentskillmania/colts/actions/workflows/ci.yml)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

**Colts** 是一个基于 pnpm 的 TypeScript monorepo，为 `@agentskillmania` 生态系统提供 ReAct Agent 框架、统一 LLM 客户端、YAML 配置管理库以及交互式终端 UI。

## 包列表

| 包 | 描述 |
|---------|-------------|
| [`@agentskillmania/colts`](./packages/colts/) | 核心 ReAct Agent 框架 — 无状态 Runner、不可变状态、三级执行控制、流式输出、上下文压缩、Skill 与 Subagent 系统 |
| [`@agentskillmania/colts-cli`](./packages/colts-cli/) | 基于 Ink 构建的终端 UI 应用 — 交互式调试与开发环境 |
| [`@agentskillmania/llm-client`](./packages/llm-client/) | 统一 LLM 客户端 — 多提供商支持、三级并发控制、优先级队列、Token 追踪 |
| [`@agentskillmania/settings-yaml`](./packages/settings-yaml/) | YAML 配置管理库 — 深度合并、默认值回退、运行时覆盖 |

## 安装

```bash
# 克隆仓库
git clone https://github.com/agentskillmania/colts.git
cd colts

# 安装依赖（强制使用 pnpm）
pnpm install
```

## 开发

```bash
# 构建所有包
pnpm build

# 监听模式
pnpm dev

# 运行所有测试
pnpm test

# 仅运行单元测试
pnpm test:unit

# 仅运行集成测试
pnpm test:intg

# 生成覆盖率报告
pnpm test:coverage

# 代码检查
pnpm lint

# 自动修复代码检查问题
pnpm lint:fix

# 格式化代码
pnpm format

# 检查格式
pnpm format:check
```

## 架构

```
colts-cli ──depends──► colts, settings-yaml
colts ──────depends──► llm-client
settings-yaml ───────► (无内部依赖)
llm-client ──────────► (无内部依赖)
```

## 环境要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0（通过 `preinstall` 脚本强制使用）

## License

MIT
