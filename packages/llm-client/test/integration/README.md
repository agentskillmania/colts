# LLM Client Integration Tests

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

This directory contains integration tests based on user stories. These tests make real API calls and require valid OpenAI API keys.

## Setup

1. Set environment variables:
```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_API_KEY2="sk-..."  # Optional, for multi-key tests
export TEST_MODEL="gpt-3.5-turbo"  # or gpt-4
export ENABLE_INTEGRATION_TESTS="true"
```

2. Or create a `.env` file in the project root.

## User Stories Covered

### Story 1: Basic Completion (`01-basic-completion.test.ts`)
- Simple non-streaming chat
- Token statistics
- Request timeout
- Multi-turn conversation context

### Story 2: Streaming (`02-streaming.test.ts`)
- Real-time character-by-character output
- Delta and accumulated content
- Trace ID support in streaming
- Timeout handling

### Story 3: Multi-Key (`03-multi-key-switching.test.ts`)
- Round-robin load balancing
- Multiple API key registration
- Key health statistics
- Single key fallback

### Story 4: Concurrency (`04-concurrency-limiting.test.ts`)
- Queue when limit reached
- Real-time stats
- Default concurrency configuration

### Story 5: Retry (`06-automatic-retry.test.ts`)
- Custom retry configuration
- Retry event monitoring
- Streaming with retry

### Story 6: Observability (`07-monitoring-debugging.test.ts`)
- Real-time stats via `getStats()`
- Request lifecycle events
- Key health tracking
- State clearing

## Running Tests

```bash
# Run all integration tests
ENABLE_INTEGRATION_TESTS=true pnpm test:integration

# Run specific story
dENABLE_INTEGRATION_TESTS=true pnpm test -- test/integration/basic-completion.test.ts
```

## Test Configuration

See `config.ts` for all configuration options.
