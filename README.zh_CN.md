# @agentskillmania/colts

[![npm version](https://img.shields.io/npm/v/@agentskillmania/colts.svg)](https://www.npmjs.com/package/@agentskillmania/colts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/agentskillmania/colts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agentskillmania/colts/actions/workflows/ci.yml)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

**Colts** 是一个基于 pnpm 的 TypeScript monorepo，为 `@agentskillmania` 生态系统提供 ReAct Agent 框架、统一 LLM 客户端和 YAML 配置管理库。

## 包列表

| 包 | 说明 |
|---------|-------------|
| [`@agentskillmania/colts`](./packages/colts/) | 核心 ReAct Agent 框架 —— 无状态 runner、不可变状态、三级执行控制、事件驱动架构、上下文压缩、技能和子代理 |
| [`@agentskillmania/llm-client`](./packages/llm-client/) | 统一 LLM 客户端 —— 多 provider 支持、三级并发控制、优先级队列和 token 统计 |
| [`@agentskillmania/settings-yaml`](./packages/settings-yaml/) | YAML 配置管理库 —— 深度合并、默认值回退和运行时覆盖 |

## 安装

```bash
# 克隆仓库
git clone https://github.com/agentskillmania/colts.git
cd colts

# 安装依赖（强制使用 pnpm）
pnpm install
```

## 使用

```typescript
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { LLMClient } from '@agentskillmania/colts/llm';   // 内置 LLM 入口（可选）

const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient: LLMClient.quickInit({ providers: [{ name: 'openai', apiKey, models: [{ modelId: 'gpt-4o' }] }] }),
});

let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, '你好');
const { result } = await runner.run(state);
```

完整 API（三级执行控制、工具、技能、事件、状态管理）见 [colts 包 README](./packages/colts/README.zh_CN.md)。

### 分层：平台无关核心 + 按需后端

主入口（`@agentskillmania/colts`）平台无关——没有 `node:` 导入、不捆绑 LLM 运行时：

| 能力 | 主入口 | 按需入口 |
|------|--------|----------|
| 内置 LLM 客户端 | 不捆绑 | `@agentskillmania/colts/llm`（re-export `LLMClient`；仅 import 时才解析 llm-client 及其 pi-ai 适配器） |
| Node 技能文件系统 | 不捆绑 | `@agentskillmania/colts/skills/node-fs-ops`（`nodeFsOps`） |

注入自己的 `ILLMProvider`（如浏览器原生 fetch 实现）或自己的 `SkillFsOps`（如 OPFS 实现）无需任何 cast——所有接口类型（`Message`、`LLMTool`、`StreamEvent`、`SkillFsOps`）都是本 monorepo 的一等平台无关类型。

### 技能（Skills）

技能（`SKILL.md` 指令集）通过可注入的 `ISkillProvider` 加载，后端是平台无关的 `SkillFsOps`——完整用法（注入模式、Node/浏览器后端、`skillDirs` 便捷路径）见 [colts 包 README](./packages/colts/README.zh_CN.md#skill-系统)。

### 事件

runner 是 `EventEmitter`（token / thinking / 工具 / 相位变更 / 技能 / 子代理事件）——见 [colts 包 README](./packages/colts/README.zh_CN.md#事件系统)。

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

# Lint
pnpm lint

# 修复 Lint 问题
pnpm lint:fix

# 格式化代码
pnpm format

# 检查格式化
pnpm format:check
```

## 架构

```
colts ──────depends──► llm-client
settings-yaml ───────► (no internal deps)
llm-client ──────────► (no internal deps)
```

## 要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0（通过 `preinstall` 脚本强制）

## 许可证

MIT
