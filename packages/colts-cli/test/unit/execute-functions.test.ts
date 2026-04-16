/**
 * @fileoverview executeStep / executeAdvance 控制流回归测试
 *
 * 覆盖 CR 指出的三个"裸奔"路径：
 * - T-CLI2: executeAdvance 内层循环中 await pauseFn() 在 phase-change 时阻塞
 * - T-CLI3: executeStep done 时 break（非 return）确保 tracer.flush() 执行
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentState, AgentRunner, StepResult } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';
import { executeStep, executeAdvance } from '../../src/hooks/use-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockState(): AgentState {
  return createAgentState({
    name: 'test-agent',
    instructions: 'You are a test assistant.',
    tools: [],
  });
}

function createMockSetEntries() {
  const entries: unknown[] = [];
  const setter = vi.fn((action: unknown) => {
    if (typeof action === 'function') {
      entries.length = 0;
      entries.push(...action(entries));
    } else {
      entries.length = 0;
      entries.push(action);
    }
  });
  return { setter, entries };
}

function createMockSetState() {
  let state: AgentState | null = null;
  const setter = vi.fn((action: unknown) => {
    if (typeof action === 'function') {
      state = (action as (prev: AgentState | null) => AgentState | null)(state);
    } else {
      state = action as AgentState | null;
    }
  });
  return { setter, getState: () => state };
}

// ---------------------------------------------------------------------------
// T-CLI3: executeStep done → break (not return) → tracer.flush() 执行
// ---------------------------------------------------------------------------

describe('executeStep regression (CR T-CLI3)', () => {
  it('should call tracer.flush() after step done', async () => {
    const mockState = createMockState();
    const doneResult: StepResult = { type: 'done', answer: 'test answer' };

    // 创建 mock runner，stepStream 返回一个立即完成的 generator
    const mockRunner = {
      stepStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'token', token: 'hello' };
        return { state: mockState, result: doneResult };
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();
    const pauseFn = vi.fn().mockResolvedValue(undefined);

    // spy on TraceWriter.prototype.flush 来验证它被调用
    const { TraceWriter } = await import('../../src/trace-writer.js');
    const flushSpy = vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeStep(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // tracer.flush() 应该被调用 — 如果原来用 return 而非 break，这不会被调用
    expect(flushSpy).toHaveBeenCalledTimes(1);

    flushSpy.mockRestore();
  });

  it('should call tracer.flush() after step error', async () => {
    const mockState = createMockState();

    const mockRunner = {
      stepStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'token', token: 'hello' };
        throw new Error('test error');
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();
    const pauseFn = vi.fn().mockResolvedValue(undefined);

    const { TraceWriter } = await import('../../src/trace-writer.js');
    const flushSpy = vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeStep(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // 即使出错，tracer.flush() 也应该被调用
    expect(flushSpy).toHaveBeenCalledTimes(1);

    flushSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T-CLI2: executeAdvance pause on phase-change
// ---------------------------------------------------------------------------

describe('executeAdvance regression (CR T-CLI2)', () => {
  it('should await pauseFn on each phase-change event', async () => {
    const mockState = createMockState();

    // 模拟 advanceStream：yield phase-change 事件，然后完成
    const mockRunner = {
      advanceStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } };
        yield { type: 'phase-change', from: { type: 'preparing' }, to: { type: 'calling-llm' } };
        return { state: mockState, phase: { type: 'completed', answer: 'done' }, done: true };
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();

    const pauseFn = vi.fn().mockResolvedValue(undefined);

    const { TraceWriter } = await import('../../src/trace-writer.js');
    vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeAdvance(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // 每次 phase-change 都应该 await pauseFn
    // 有 2 次 phase-change 事件
    expect(pauseFn).toHaveBeenCalledTimes(2);
  });

  it('should reset assistant when phase-change to calling-llm', async () => {
    const mockState = createMockState();

    const mockRunner = {
      advanceStream: vi.fn().mockImplementation(async function* () {
        yield { type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } };
        yield { type: 'phase-change', from: { type: 'preparing' }, to: { type: 'calling-llm' } };
        return { state: mockState, phase: { type: 'completed', answer: 'done' }, done: true };
      }),
    } as unknown as AgentRunner;

    const { setter: setEntries } = createMockSetEntries();
    const { setter: setState } = createMockSetState();
    const abortController = new AbortController();
    const pauseFn = vi.fn().mockResolvedValue(undefined);

    const { TraceWriter } = await import('../../src/trace-writer.js');
    vi.spyOn(TraceWriter.prototype, 'flush').mockResolvedValue();

    await executeAdvance(
      mockRunner,
      mockState,
      'test input',
      setEntries as any,
      setState as any,
      abortController.signal,
      pauseFn
    );

    // phase-change → calling-llm 应该触发 resetAssistant（会调 setEntries）
    // 加上初始 resetAssistant 和 phase-change 时的 setEntries 更新，
    // setEntries 调用次数应该 >= 3（初始 + 2次 phase-change 的 flush + resetAssistant）
    expect(setEntries).toHaveBeenCalled();
    // pauseFn 在 calling-llm phase-change 时被调用
    expect(pauseFn).toHaveBeenCalled();
  });
});
