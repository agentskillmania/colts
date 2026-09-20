/**
 * @fileoverview 意图构造器基线等价测试（R2P-109，对齐 Rust 216f9c5 的
 * 三组基线：与 wrangler command/a2ui 中间件旧手搓产物逐字段对齐）。
 *
 * 等价钉死三件事：相位判别 + 关键字段（fromCommand/requests/tokens）+
 * state 引用一致。迁移后（wrangler 侧改用构造器）这些基线就是契约。
 */

import { describe, it, expect } from 'vitest';

import { completeFromCommand, waitHuman, runComplete } from '../../../src/middleware/intents.js';
import type { AgentState } from '../../../src/types.js';
import type { ExecutionState } from '../../../src/execution/index.js';
import { createAgentState } from '../../../src/state/index.js';

function makeExecState(): ExecutionState {
  return {
    phase: { type: 'idle' },
    stepCount: 0,
    tokens: { input: 11, output: 7, cacheRead: 0, cacheWrite: 0 },
  } as unknown as ExecutionState;
}

function makeState(): AgentState {
  return createAgentState({ name: 't', instructions: '', tools: [] });
}

describe('completeFromCommand（command 拦截旧手搓基线）', () => {
  it('builds the completed phase with the fromCommand marker, done, no tokens', () => {
    const state = makeState();
    const execState = makeExecState();
    const hook = completeFromCommand(state, execState, 'Session cleared.') as {
      stop: true;
      result: {
        state: AgentState;
        execState: ExecutionState;
        phase: { type: 'completed'; answer: string; fromCommand?: true };
        done: boolean;
        tokens?: unknown;
        effects?: unknown[];
        estimatedContextSize?: unknown;
      };
    };

    expect(hook.stop).toBe(true);
    expect(hook.result.state).toBe(state);
    expect(hook.result.execState).toBe(execState);
    expect(hook.result.phase).toEqual({
      type: 'completed',
      answer: 'Session cleared.',
      fromCommand: true,
    });
    expect(hook.result.done).toBe(true);
    expect(hook.result.tokens).toBeUndefined();
    expect(hook.result.effects).toBeUndefined();
    expect(hook.result.estimatedContextSize).toBeUndefined();
  });
});

describe('waitHuman（HITL 挂起旧手搓基线）', () => {
  it('builds the waiting-human phase, forwards tokens, rewrites execState phase in both places', () => {
    const state = makeState();
    const execState = makeExecState();
    const request = {
      type: 'question',
      questions: [{ id: 'q1', question: 'Proceed?', type: 'text' }],
      toolCallId: 'call-1',
    } as never;

    const hook = waitHuman(state, execState, request) as {
      state: AgentState;
      execState: ExecutionState;
      stop: true;
      result: {
        state: AgentState;
        execState: ExecutionState;
        phase: { type: 'waiting-human'; request: unknown; requests: unknown[] };
        done: boolean;
        tokens: { input: number };
      };
    };

    expect(hook.stop).toBe(true);
    expect(hook.state).toBe(state);
    // 钩子层 execState 与 result 内各带一份（相位均已改写）
    expect(hook.execState.phase.type).toBe('waiting-human');
    expect(hook.result.execState.phase.type).toBe('waiting-human');
    expect(hook.result.phase.type).toBe('waiting-human');
    expect(hook.result.phase.request).toBe(request);
    // 单请求调用：requests 缺省为 [request]（request === requests[0]）
    expect(hook.result.phase.requests).toEqual([request]);
    expect(hook.result.done).toBe(true);
    // token 结算透传当前 exec 状态的值
    expect(hook.result.tokens).toEqual({ input: 11, output: 7, cacheRead: 0, cacheWrite: 0 });
  });

  it('accepts the parallel full-list form (requests carries all, request is [0])', () => {
    const r0 = { type: 'question', questions: [], toolCallId: 'a' } as never;
    const r1 = { type: 'question', questions: [], toolCallId: 'b' } as never;
    const hook = waitHuman(makeState(), makeExecState(), r0, [r0, r1]) as {
      result: { phase: { requests: unknown[] } };
    };
    expect(hook.result.phase.requests).toEqual([r0, r1]);
  });
});

describe('runComplete（command beforeRun 旧手搓 RunResult 基线）', () => {
  it('builds success terminal with zero steps and zero usage', () => {
    const state = makeState();
    const hook = runComplete(state, '/compact done') as {
      state: AgentState;
      stop: true;
      result: {
        type: 'success';
        answer: string;
        totalSteps: number;
        tokens: { input: number; output: number };
        duration: number;
      };
    };

    expect(hook.stop).toBe(true);
    expect(hook.state).toBe(state);
    expect(hook.result).toEqual({
      type: 'success',
      answer: '/compact done',
      totalSteps: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      duration: 0,
    });
  });

  it('works without a state (stateless interception)', () => {
    const hook = runComplete(undefined, 'ok') as { result: { type: string }; state?: unknown };
    expect(hook.result.type).toBe('success');
    expect(hook.state).toBeUndefined();
  });
});

describe('stopped collapse forwards the fromCommand marker (R2P-109)', () => {
  it('runner run() surfaces fromCommand on the stopped RunResult', async () => {
    const { AgentRunner } = await import('../../../src/runner/index.js');
    const { createCallOnlyMockLLMClient } = await import('../../helpers/mock-llm.js');

    const runner = new AgentRunner({
      model: 'test-model',
      llmClient: createCallOnlyMockLLMClient([{ content: 'x', toolCalls: [] }]),
      middleware: [
        {
          name: 'cmd',
          beforeAdvance: async () => completeFromCommand(makeState(), makeExecState(), '已清理'),
        },
      ],
      maxSteps: 1,
    });

    const { result } = await runner.run(makeState());
    expect(result.type).toBe('stopped');
    const stopped = result as { type: 'stopped'; data?: string; fromCommand?: true };
    expect(stopped.data).toBe('已清理');
    expect(stopped.fromCommand).toBe(true);
  });

  it('plain stopped results (no marker) stay shape-identical', async () => {
    const { AgentRunner } = await import('../../../src/runner/index.js');
    const { createCallOnlyMockLLMClient } = await import('../../helpers/mock-llm.js');

    const runner = new AgentRunner({
      model: 'test-model',
      llmClient: createCallOnlyMockLLMClient([{ content: 'x', toolCalls: [] }]),
      middleware: [
        {
          name: 'plain-stop',
          beforeAdvance: async () => ({
            stop: true,
            result: {
              state: makeState(),
              execState: makeExecState(),
              phase: { type: 'completed', answer: 'plain' },
              done: true,
            },
          }),
        },
      ],
      maxSteps: 1,
    });

    const { result } = await runner.run(makeState());
    const stopped = result as { type: 'stopped'; fromCommand?: true };
    expect(stopped.type).toBe('stopped');
    expect(stopped.fromCommand).toBeUndefined();
    expect('fromCommand' in stopped).toBe(false);
  });
});
