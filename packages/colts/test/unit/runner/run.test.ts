/**
 * @fileoverview run() tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, LLMResponse } from '@agentskillmania/llm-client';
import {
  AgentRunner,
  DEFAULT_RUNNER_MAX_STEPS,
  RUN_HARD_LIMIT,
} from '../../../src/runner/index.js';
import { DefaultContextCompressor } from '../../../src/compressor/index.js';
import { createAgentState, addUserMessage } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { createMockLLMClient as _createMockLLMClient } from '../../helpers/mock-llm.js';
import { safeEval } from '../helpers/safe-eval.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import { z } from 'zod';

// Helper to create mock LLM client
const createMockLLMClient = (responses: LLMResponse[]) =>
  _createMockLLMClient(responses, { enableThinking: true });
// Default config for tests
const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

// Mock token stats
const mockTokens = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
};

describe('run()', () => {
  it('should return success for single-step direct answer', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The answer is 42');
      expect(result.totalSteps).toBe(1);
    }

    // Token tracking
    expect(result.tokens).toEqual(mockTokens);
    expect(finalState.context.totalTokens).toEqual(mockTokens);

    // Duration tracking
    expect(result.duration).toBeGreaterThanOrEqual(0);

    // Original state is immutable
    expect(state.context.stepCount).toBe(0);
    expect(finalState.context.stepCount).toBe(1);
  });

  it('should emit complete event via EventEmitter', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const events: Array<{ type: string; result?: unknown }> = [];
    runner.on('complete', (data) => events.push({ type: 'complete', result: data.result }));
    runner.on('run:end', (data) => events.push({ type: 'run:end', result: data.result }));

    const state = createAgentState(defaultConfig);
    await runner.run(state);

    expect(events.some((e) => e.type === 'complete')).toBe(true);
    const completeEvent = events.find((e) => e.type === 'complete');
    expect(completeEvent?.result).toBeDefined();
    expect((completeEvent?.result as { type: string }).type).toBe('success');
  });

  it('should loop through tool execution to final answer', async () => {
    const responses: LLMResponse[] = [
      {
        // Step 1: LLM calls tool
        content: 'Let me calculate',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '2+2' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        // Step 2: LLM gives final answer
        content: 'The result is 4',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState, result } = await runner.run(state, undefined, registry);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The result is 4');
      expect(result.totalSteps).toBe(2);
    }

    // Token tracking: accumulated across 2 steps
    expect(result.tokens).toEqual({ input: 20, output: 10, cacheRead: 0, cacheWrite: 0 });
    expect(finalState.context.totalTokens).toEqual({
      input: 20,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
    });

    // Duration tracking
    expect(result.duration).toBeGreaterThanOrEqual(0);

    expect(finalState.context.stepCount).toBe(2);
    expect(state.context.stepCount).toBe(0);
  });

  it('should return max_steps when limit is reached', async () => {
    // LLM calls tool every time, never stops
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    // Return enough tool call responses
    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state, { maxSteps: 3 }, registry);

    expect(result.type).toBe('max_steps');
    if (result.type === 'max_steps') {
      expect(result.totalSteps).toBe(3);
    }
  });

  it('should use default maxSteps of 500', () => {
    expect(DEFAULT_RUNNER_MAX_STEPS).toBe(500);
  });

  it('should handle LLM error and return error result', async () => {
    const client = {
      call: vi.fn().mockRejectedValue(new Error('API error')),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error('API error');
      }),
      getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
    } as unknown as LLMClient;

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    // step() catches error internally, returns error
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.message).toBe('API error');
      expect(result.totalSteps).toBe(1);
    }
  });

  it('should use runner tool registry as default', async () => {
    const responses: LLMResponse[] = [
      {
        content: 'Calculating',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '5*5' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 25',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, toolRegistry: registry });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('The result is 25');
    }
  });
});

describe('run() event emission', () => {
  it('should emit compress events in run when compression is triggered', async () => {
    // R2P-104 返修：发射下沉到 maybeCompress 共享 helper 后，StepRunner 步内
    // 压缩同样发射——事件数从固定 4 条（仅步间）变为每次真实压缩一对。
    const toolCallResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const finalResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, toolCallResponse, finalResponse]);

    let compressCount = 0;
    const mockCompressor: import('../../../src/types.js').IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(true),
      compress: vi.fn().mockImplementation(() => {
        compressCount++;
        return Promise.resolve({
          summary: 'Test summary ' + compressCount,
          anchor: 5 * compressCount,
        });
      }),
    };

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor: mockCompressor,
    });

    const state = createAgentState(defaultConfig);

    const events: string[] = [];
    runner.on('compressing', () => events.push('compressing'));
    runner.on('compressed', () => events.push('compressed'));

    await runner.run(state, undefined, registry);

    // 步内路径也发射：远多于旧契约的 4 条（2 对）
    expect(events.length).toBeGreaterThanOrEqual(6);
    // 严格 compressing → compressed 成对交替
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]).toBe('compressing');
      expect(events[i + 1]).toBe('compressed');
    }
  });

  it('should emit coveredMessages (per-round anchor delta) on every compressed event (R2P-104)', async () => {
    // removedCount 的单位随路径而变（历史遗留），时间线标记需要无歧义的
    // 消息条数——coveredMessages = 本轮 anchor 增量（新 anchor − prevAnchor）。
    // 注意时序：StepRunner 每步内部还有静默 maybeCompress（不发射事件但推进
    // anchor），故 mock 的 anchor 必须是 existingAnchor 的纯函数——每次调用
    // 恒 +2，则无论内部交织多少次，每轮发射的增量都精确为 2（对齐 Rust
    // 7d964e5：时间线标记以本字段为准）。
    const toolCallResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const finalResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
      finalResponse,
    ]);

    const mockCompressor: import('../../../src/types.js').IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(true),
      compress: vi.fn().mockImplementation((state: import('../../../src/types.js').AgentState) => {
        const existingAnchor = state.context.compression?.anchor ?? 0;
        return Promise.resolve({
          summary: 'Test summary',
          anchor: existingAnchor + 2,
        });
      }),
    };

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor: mockCompressor,
    });

    const state = createAgentState(defaultConfig);

    const payloads: Array<{ coveredMessages?: number }> = [];
    runner.on('compressed', (e) => payloads.push(e));

    await runner.run(state, undefined, registry);

    // R2P-104 返修：步内压缩路径同样发射——轮数远多于旧契约的 3 条。
    // 每轮 anchor 增量都是 2——杀「累计 anchor」「只在首轮算增量」
    // 「漏字段」「只步间发射」等变异实现
    expect(payloads.length).toBeGreaterThanOrEqual(5);
    expect(payloads.map((p) => p.coveredMessages)).toEqual(Array(payloads.length).fill(2));
  });

  it('should emit coveredMessages 0 when the anchor makes no progress (R2P-104)', async () => {
    // 放弃/no-op：compressor 不推进 anchor（返回 existingAnchor）→ 本轮
    // 没有盖住任何消息。事件仍发射（压缩元数据已写入），但增量为 0。
    const toolCallResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const finalResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, toolCallResponse, finalResponse]);

    const mockCompressor: import('../../../src/types.js').IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(true),
      compress: vi.fn().mockImplementation((state: import('../../../src/types.js').AgentState) => {
        const existingAnchor = state.context.compression?.anchor ?? 0;
        return Promise.resolve({ summary: 'no progress', anchor: existingAnchor });
      }),
    };

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor: mockCompressor,
    });

    const state = createAgentState(defaultConfig);

    const payloads: Array<{ coveredMessages?: number }> = [];
    runner.on('compressed', (e) => payloads.push(e));

    await runner.run(state, undefined, registry);

    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.map((p) => p.coveredMessages)).toEqual(Array(payloads.length).fill(0));
  });

  it('should emit compressed for real in-step compressions — ΣcoveredMessages telescopes to final anchor (R2P-104 返修 P1)', async () => {
    // 评审 P1 复现：真实 DefaultContextCompressor 走 run()——旧实现只在步间
    // 发射，而真实压缩器一轮成功后 shouldCompress 回落、同数组重算无法再
    // 推进 → compressed 零发射（anchor 推进全部静默发生在 StepRunner 步内）。
    // 修复后发射随 maybeCompress 下沉：每次真实压缩可见，且 anchor 变化只
    // 经发射发生 → ΣcoveredMessages 严格望远镜求和 = 最终 anchor。
    const toolCallResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const finalResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
      toolCallResponse,
      finalResponse,
    ]);

    // 真实压缩器：truncate、窗口 60（90% 触发线 54）。12 条种子 user 消息
    // 估算 ~120 token ≥ 54 必触发；keepRecent=10 → 朴素锚点 12−10=2 落 user。
    const compressor = new DefaultContextCompressor({
      strategy: 'truncate',
      contextWindowSize: 60,
    });

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor,
    });

    let state = createAgentState(defaultConfig);
    for (let i = 0; i < 12; i++) {
      state = addUserMessage(state, `Seed message ${i} for compression window accounting`);
    }

    const payloads: Array<{ coveredMessages?: number }> = [];
    runner.on('compressed', (e) => payloads.push(e));

    const { state: finalState } = await runner.run(state, undefined, registry);

    // 修复前（P1）：此处为 0 条事件
    expect(payloads.length).toBeGreaterThan(0);
    const finalAnchor = finalState.context.compression?.anchor ?? 0;
    expect(finalAnchor).toBeGreaterThan(0);
    // 每轮增量非负（anchor 单调不回退），且总和望远镜到最终 anchor
    for (const p of payloads) {
      expect(p.coveredMessages).toBeGreaterThanOrEqual(0);
    }
    expect(payloads.reduce((sum, p) => sum + (p.coveredMessages ?? 0), 0)).toBe(finalAnchor);
  });

  it('should emit coveredMessages 0 when a compressor regresses the anchor (saturating; kills swap mutant)', async () => {
    // P2：饱和分支。mock 回退：existingAnchor=5 → 返回 3。
    // Math.max(0, 3−5)=0；swap 变异（Math.max(0, prev−new)）会得 2 —— 被杀。
    const toolCallResponse: LLMResponse = {
      content: 'Calculating',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };
    const finalResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, finalResponse]);

    const mockCompressor: import('../../../src/types.js').IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(true),
      compress: vi.fn().mockResolvedValue({ summary: 'regressed', anchor: 3 }),
    };

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      compressor: mockCompressor,
    });

    const state = createAgentState(defaultConfig);
    // 种子压缩锚点 5：压缩器返回 3 → anchor 回退 2 条
    state.context.compression = { summary: 'seed', anchor: 5 };

    const payloads: Array<{ coveredMessages?: number }> = [];
    runner.on('compressed', (e) => payloads.push(e));

    await runner.run(state, undefined, registry);

    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.map((p) => p.coveredMessages)).toEqual(Array(payloads.length).fill(0));
  });

  it('should emit abort event when custom policy returns abort in run()', async () => {
    const client = createMockLLMClient([
      { content: 'Hello', toolCalls: [], tokens: mockTokens, stopReason: 'stop' },
    ]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({ decision: 'stop', reason: 'abort', runResultType: 'abort' }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);

    const events: string[] = [];
    runner.on('abort', () => events.push('abort'));

    const { result } = await runner.run(state);

    expect(result.type).toBe('abort');
    expect(events).toContain('abort');
  });

  it('should preserve content in assistant message when tool_calls are present', async () => {
    // LLM outputs explanatory text before tool_call — standard behavior, not misbehavior
    const responses: LLMResponse[] = [
      {
        content: 'Let me calculate that for you.',
        toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '3+3' } }],
        tokens: mockTokens,
        stopReason: 'tool_calls',
      },
      {
        content: 'The result is 6',
        toolCalls: [],
        tokens: mockTokens,
        stopReason: 'stop',
      },
    ];

    const client = createMockLLMClient(responses);
    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state, undefined, registry);

    // Find the assistant message with tool_calls — content should be preserved
    const assistantMsgs = finalState.context.messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);

    const actionMsg = assistantMsgs.find((m) => m.type === 'action');
    expect(actionMsg).toBeDefined();
    expect(actionMsg!.content).toBe('Let me calculate that for you.');
    expect(actionMsg!.toolCalls).toHaveLength(1);
    expect(actionMsg!.toolCalls![0].name).toBe('calculate');
  });
});

// ============================================================
// Custom Execution Policy tests
// ============================================================
describe('Execution Policy injection', () => {
  it('should call custom policy.shouldStop() on each step', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const shouldStopCalls: { stepCount: number; resultType: string }[] = [];

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: (_state, result, meta) => {
          shouldStopCalls.push({ stepCount: meta.stepCount, resultType: result.type });
          if (result.type === 'done') {
            return { decision: 'stop', reason: result.answer, runResultType: 'success' as const };
          }
          if (result.type === 'error') {
            return {
              decision: 'stop',
              reason: result.error.message,
              runResultType: 'error' as const,
            };
          }
          if (meta.stepCount >= meta.maxSteps) {
            return { decision: 'stop', reason: 'Max steps', runResultType: 'max_steps' as const };
          }
          return { decision: 'continue' };
        },
        onToolError: () => ({ decision: 'continue' as const, sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail' as const, error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(result.type).toBe('success');
    expect(shouldStopCalls).toHaveLength(1);
    expect(shouldStopCalls[0]).toEqual({ stepCount: 1, resultType: 'done' });
  });

  it('should allow custom policy to override stop behavior', async () => {
    // LLM gives a direct answer, but custom policy treats it as max_steps
    const mockResponse: LLMResponse = {
      content: 'Direct answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({
          decision: 'stop',
          reason: 'Custom override',
          runResultType: 'max_steps',
        }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    // Policy overrides: even though LLM gave a direct answer, result is max_steps
    expect(result.type).toBe('max_steps');
  });

  it('should use DefaultExecutionPolicy when no policy is provided', async () => {
    const mockResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { result } = await runner.run(state);

    // Default policy: direct answer → success
    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('Answer');
    }
  });

  it('should expose RUN_HARD_LIMIT of 1000', () => {
    expect(RUN_HARD_LIMIT).toBe(1000);
  });

  it('should stop with max_steps when policy never stops and maxSteps is reached', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Thinking...',
      toolCalls: [{ id: 'call-1', name: 'calculate', arguments: { expression: '1+1' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const responses = Array(10).fill(toolCallResponse);
    const client = createMockLLMClient(responses);

    const registry = new ToolRegistry();
    registry.register({
      name: 'calculate',
      description: 'Calculate',
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => safeEval(expression).toString(),
    });

    // Policy that never stops (always continues)
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      runHardLimit: 5,
      executionPolicy: {
        shouldStop: () => ({ decision: 'continue' }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state, undefined, registry);

    expect(result.type).toBe('max_steps');
    if (result.type === 'max_steps') {
      expect(result.totalSteps).toBe(5);
    }
  });

  it('should fallback to max_steps when policy returns unknown runResultType in run()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Answer',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);

    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      executionPolicy: {
        shouldStop: () => ({
          decision: 'stop',
          reason: 'Unknown type',
          runResultType:
            'unknown_type' as unknown as import('../../../src/policy/types.js').RunResultType,
        }),
        onToolError: () => ({ decision: 'continue', sanitizedResult: 'Error' }),
        onParseError: (error) => ({ decision: 'fail', error }),
      },
    });

    const state = createAgentState(defaultConfig);
    const { result } = await runner.run(state);

    expect(result.type).toBe('max_steps');
  });
});

describe('Thinking mechanism', () => {
  it('should save native thinking as thought message in blocking mode', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42.',
      thinking: 'Let me reason through this.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state);

    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');
    const textMsg = messages.find((m) => m.type === 'text');

    expect(thoughtMsg!.content).toBe('Let me reason through this.');
    expect(textMsg!.content).toBe('The answer is 42.');
  });

  it('should extract <think> tag and clean content in blocking mode', async () => {
    const mockResponse: LLMResponse = {
      content: '<think>I need to calculate this.</think>The answer is 42.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state);

    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');
    const textMsg = messages.find((m) => m.type === 'text');

    expect(thoughtMsg!.content).toBe('I need to calculate this.');
    expect(textMsg!.content).toBe('The answer is 42.');
  });

  it('should save native thinking with action in blocking mode', async () => {
    const toolCallResponse: LLMResponse = {
      content: 'Let me search.',
      thinking: 'The user wants weather info.',
      toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'weather' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const finalResponse: LLMResponse = {
      content: 'It is sunny.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, finalResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const registry = new ToolRegistry();
    registry.register({
      name: 'search',
      description: 'Search',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `Results for ${query}`,
    });

    const state = createAgentState(defaultConfig);
    const { state: finalState } = await runner.run(state, undefined, registry);

    const messages = finalState.context.messages;
    const thoughtMsgs = messages.filter((m) => m.type === 'thought');

    expect(thoughtMsgs.length).toBe(1);
    expect(thoughtMsgs[0].content).toBe('The user wants weather info.');
  });

  it('should NOT create thought message when no thinking exists', async () => {
    const mockResponse: LLMResponse = {
      content: 'The answer is 42.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });
    const state = createAgentState(defaultConfig);

    const { state: finalState } = await runner.run(state);

    const messages = finalState.context.messages;
    const thoughtMsg = messages.find((m) => m.type === 'thought');

    expect(thoughtMsg).toBeUndefined();
  });

  it('should handle <think> tag with action in blocking mode', async () => {
    const toolCallResponse: LLMResponse = {
      content: '<think>I need to search.</think>',
      toolCalls: [{ id: 'call-1', name: 'search', arguments: { query: 'weather' } }],
      tokens: mockTokens,
      stopReason: 'tool_calls',
    };

    const finalResponse: LLMResponse = {
      content: 'It is sunny.',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([toolCallResponse, finalResponse]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const registry = new ToolRegistry();
    registry.register({
      name: 'search',
      description: 'Search',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `Results for ${query}`,
    });

    const state = createAgentState(defaultConfig);
    const { state: finalState } = await runner.run(state, undefined, registry);

    const messages = finalState.context.messages;
    const thoughtMsgs = messages.filter((m) => m.type === 'thought');
    const actionMsgs = messages.filter((m) => m.type === 'action');

    expect(thoughtMsgs.length).toBe(1);
    expect(thoughtMsgs[0].content).toBe('I need to search.');
    expect(actionMsgs.length).toBe(1);
    expect(actionMsgs[0].content).toBe('');
  });

  it('should return custom result when beforeRun middleware stops with result', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-beforeRun-stop',
          async beforeRun() {
            return {
              stop: true,
              result: {
                type: 'success',
                answer: 'Custom result',
                totalSteps: 0,
                tokens: { input: 0, output: 0 },
              },
            };
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    // A previous turn's assistant row: the beforeRun interception path never
    // reaches the terminal usage stamp, so it must stay unaccounted.
    state.context.messages = [
      {
        id: 'a-prev',
        role: 'assistant',
        content: 'previous answer',
        type: 'text',
        timestamp: 0,
        tokenCount: 1,
      },
    ];
    const { state: finalState, result } = await runner.run(state);

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.answer).toBe('Custom result');
    }
    // Interception path writes no usage (R2P-106).
    expect(finalState.context.messages.every((m) => m.usage === undefined)).toBe(true);
  });

  it('should propagate error when beforeRun throws in run()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-throw-run',
          async beforeRun() {
            throw new Error('beforeRun run error');
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    await expect(runner.run(state)).rejects.toThrow('beforeRun run error');
  });

  it('should propagate non-Error throw from beforeRun in run()', async () => {
    const mockResponse: LLMResponse = {
      content: 'Hello',
      toolCalls: [],
      tokens: mockTokens,
      stopReason: 'stop',
    };

    const client = createMockLLMClient([mockResponse]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      middleware: [
        {
          name: 'test-throw-string',
          async beforeRun() {
            throw 'string error';
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    await expect(runner.run(state)).rejects.toThrow('string error');
  });
});
