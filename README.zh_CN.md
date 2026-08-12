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

// 1. 创建 runner（llmClient 可以是任意 ILLMProvider 实现）
const runner = new AgentRunner({
  model: 'gpt-4o',
  llmClient,              // 你的 ILLMProvider 实现
  tools: [],              // ColtsTool[]
  systemPrompt: 'You are a helpful assistant.',
});

// 2. 创建状态、添加用户消息并运行
let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, '你好');
const { state: finalState, result } = await runner.run(state);

// 3. result 是可辨识联合类型
if (result.type === 'success') {
  console.log('Answer:', result.answer);
}
```

### 技能（Skills）

技能是包含 `SKILL.md`（YAML frontmatter + 指令）的目录。`FilesystemSkillProvider` 通过 `SkillFsOps` 抽象扫描技能目录：

- **Node**：启动时注册一次默认后端 —— `setDefaultSkillFsOps(nodeFsOps)` —— 然后 `new FilesystemSkillProvider(dirs)` 即可使用
- **浏览器**：注入基于 OPFS 的 `SkillFsOps`（本模块从不导入 `node:` 模块，可运行在任何环境）

```typescript
import { FilesystemSkillProvider } from '@agentskillmania/colts';
// Node：启动时执行一次 setDefaultSkillFsOps(nodeFsOps)
const provider = new FilesystemSkillProvider(['./skills']);
const manifests = await provider.listSkills();
```

### 事件

runner 是 `EventEmitter`。在调用 `run()` 之前订阅：

```typescript
runner.on('step:start', ({ step }) => console.log('step', step));
runner.on('token', ({ token }) => process.stdout.write(token));
runner.on('tool:start', ({ action }) => console.log('tool', action.tool));
runner.on('llm:request', ({ model }) => console.log('llm call:', model));
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
