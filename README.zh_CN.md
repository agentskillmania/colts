# @agentskillmania/colts

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

Agent 框架和工具的 Monorepo。

## 包

| 包 | 描述 |
|---------|-------------|
| [@agentskillmania/colts](./packages/colts/) | 具有详细输出、分步执行和状态透明性的 Agent 框架 |
| [@agentskillmania/colts-cli](./packages/colts-cli/) | 用于交互式 agent 调试和开发的终端 UI（TUI） |
| [@agentskillmania/llm-client](./packages/llm-client/) | 支持多提供商的统一 LLM 客户端 |
| [@agentskillmania/settings-yaml](./packages/settings-yaml/) | YAML 配置文件读取器 |

## 开发

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行测试
pnpm test

# 运行代码检查
pnpm lint

# 格式化代码
pnpm format
```

## License

MIT
