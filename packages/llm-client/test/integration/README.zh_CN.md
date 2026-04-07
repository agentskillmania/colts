# LLM Client 集成测试

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

本目录包含基于用户故事的集成测试。这些测试会调用真实的 API，需要有效的 OpenAI API 密钥。

## 设置

1. 设置环境变量：
```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_API_KEY2="sk-..."  # 可选，用于多密钥测试
export TEST_MODEL="gpt-3.5-turbo"  # 或 gpt-4
export ENABLE_INTEGRATION_TESTS="true"
```

2. 或在项目根目录创建 `.env` 文件。

## 覆盖的用户故事

### Story 1: 基础完成 (`basic-completion.test.ts`)
- 简单的非流式对话
- Token 统计
- 请求超时
- 多轮对话上下文

### Story 2: 流式 (`streaming.test.ts`)
- 实时逐字符输出
- Delta 和累积内容
- 流式中的 Trace ID 支持
- 超时处理

### Story 3: 多密钥 (`multi-key.test.ts`)
- 轮询负载均衡
- 多个 API 密钥注册
- 密钥健康统计
- 单密钥回退

### Story 4: 并发 (`concurrency.test.ts`)
- 达到限制时的队列
- 实时统计
- 默认并发配置

### Story 5: 优先级 (`priority.test.ts`)
- 高优先级请求优先处理
- 队列位置估计
- 默认优先级 (0)

### Story 6: 重试 (`retry.test.ts`)
- 自定义重试配置
- 重试事件监控
- 带重试的流式

### Story 7: 可观测性 (`observability.test.ts`)
- 通过 `getStats()` 获取实时统计
- 请求生命周期事件
- 密钥健康追踪
- 状态清除

## 运行测试

```bash
# 运行所有集成测试
ENABLE_INTEGRATION_TESTS=true pnpm test:integration

# 运行特定故事
ENABLE_INTEGRATION_TESTS=true pnpm test -- test/integration/basic-completion.test.ts
```

## 测试配置

所有配置选项请参见 `config.ts`。

## 使用智谱 AI

要使用智谱 AI (ZhiPu AI) 进行测试：

```bash
# .env 文件
OPENAI_API_KEY=your-zhipu-api-key
OPENAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
MODEL=GLM-4.7
ENABLE_INTEGRATION_TESTS=true
```
