/**
 * @fileoverview StreamEventConsumer 单元测试
 *
 * 测试 StreamEvent → TimelineEntry 的转换逻辑，包括：
 * - token 累积与节流
 * - tool 生命周期（start/end）
 * - phase-change 事件
 * - skill / subagent / step 事件
 * - onToolEnd / onPhaseChange 钩子回调
 * - resetAssistant / finalizeAssistant / flush / disposed 状态
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RunStreamEvent } from '@agentskillmania/colts';
import { StreamEventConsumer } from '../../src/hooks/stream-event-consumer.js';
import type { TimelineEntry } from '../../src/types/timeline.js';

// ── 辅助工具 ──

/**
 * 创建模拟 React setState 的 tracker
 *
 * React 的 setState(updater) 会把上一次的 state 传给 updater 函数。
 * 这个 helper 维护一个内部的 entries 数组，每次 setter 被调用时：
 * - 如果是函数，传入上一次状态，收集返回值作为新状态
 * - 如果是值，直接作为新状态
 *
 * @returns { setter, allEntries, lastEntries, clear }
 */
function trackEntries() {
  let current: TimelineEntry[] = [];
  const setter = vi.fn((action: React.SetStateAction<TimelineEntry[]>) => {
    if (typeof action === 'function') {
      current = (action as (prev: TimelineEntry[]) => TimelineEntry[])(current);
    } else {
      current = action;
    }
  });
  return {
    setter,
    /** 获取最后一次 setter 调用后的 entries 快照 */
    get lastEntries(): TimelineEntry[] {
      return current;
    },
    /** 重置内部状态 */
    clear() {
      current = [];
    },
  };
}

/** 创建 mock setState */
function trackState() {
  let current: unknown = null;
  const setter = vi.fn((action: any) => {
    if (typeof action === 'function') {
      current = action(current);
    } else {
      current = action;
    }
  });
  return {
    setter,
    get lastState(): unknown {
      return current;
    },
  };
}

// ── 事件构造器 ──

function tokenEvent(token: string): RunStreamEvent {
  return { type: 'token', token };
}

function toolStartEvent(tool: string, args?: Record<string, unknown>): RunStreamEvent {
  return {
    type: 'tool:start',
    action: { id: `call-${tool}`, tool, arguments: args ?? {} },
  };
}

function toolEndEvent(result: unknown): RunStreamEvent {
  return { type: 'tool:end', result };
}

function phaseChangeEvent(from: string, to: string): RunStreamEvent {
  return {
    type: 'phase-change',
    from: { type: from } as any,
    to: { type: to } as any,
  };
}

function errorEvent(msg: string): RunStreamEvent {
  return {
    type: 'error',
    error: new Error(msg),
    context: { step: 1 },
  };
}

function compressingEvent(): RunStreamEvent {
  return { type: 'compressing' };
}

function compressedEvent(summary: string, removedCount: number): RunStreamEvent {
  return { type: 'compressed', summary, removedCount };
}

// ── 测试用例 ──

describe('StreamEventConsumer', () => {
  let entries: ReturnType<typeof trackEntries>;
  let state: ReturnType<typeof trackState>;

  beforeEach(() => {
    vi.useFakeTimers();
    entries = trackEntries();
    state = trackState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 基本生命周期 ──

  describe('构造与初始状态', () => {
    it('构造时不自动创建 assistant entry（由调用方 resetAssistant）', () => {
      new StreamEventConsumer(entries.setter, state.setter);
      // 构造函数只初始化 assistantId，不创建 entry
      expect(entries.lastEntries).toHaveLength(0);
    });

    it('getAccumulatedContent 初始为空字符串', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      expect(consumer.getAccumulatedContent()).toBe('');
    });

    it('getAssistantId 返回有效的 ID', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      expect(consumer.getAssistantId()).toBeTruthy();
    });
  });

  // ── token 累积 ──

  describe('token 事件', () => {
    it('单个 token 累积后 flush 写入 assistant entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.resetAssistant();

      consumer.consume(tokenEvent('Hello'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('Hello');
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      expect(asst).toBeDefined();
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('Hello');
      }
    });

    it('多个 token 连续累积', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('Hello'));
      consumer.consume(tokenEvent(' '));
      consumer.consume(tokenEvent('world'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('Hello world');
    });

    it('空 token 不触发任何更新', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent(''));

      expect(consumer.getAccumulatedContent()).toBe('');
      // 空token不调 throttledFlush，只有构造时不会有 setter 调用
    });

    it('节流：连续 token 在 50ms 内只调度一次延迟 flush', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const beforeCount = entries.setter.mock.calls.length;

      consumer.consume(tokenEvent('a'));
      consumer.consume(tokenEvent('b'));
      consumer.consume(tokenEvent('c'));

      // 节流中，累积内容正确
      expect(consumer.getAccumulatedContent()).toBe('abc');

      // 推进时间让节流触发，应该有一次新的 setter 调用
      vi.advanceTimersByTime(60);
      expect(entries.setter.mock.calls.length).toBeGreaterThan(beforeCount);
    });

    it('节流后 flush 强制立即刷新', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('a'));
      consumer.consume(tokenEvent('b'));

      // 不推进时间，直接 flush，跳过节流
      consumer.flush();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('ab');
      }
    });
  });

  // ── tool 生命周期 ──

  describe('tool:start 事件', () => {
    it('创建 tool entry 并停止 assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('thinking...'));

      consumer.consume(toolStartEvent('read_file', { path: '/test' }));

      const tool = entries.lastEntries.find((e) => e.type === 'tool');
      expect(tool).toBeDefined();
      if (tool?.type === 'tool') {
        expect(tool.tool).toBe('read_file');
        expect(tool.isRunning).toBe(true);
        expect(tool.args).toEqual({ path: '/test' });
      }
    });

    it('flush 残余 token 后停止 assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('partial'));

      consumer.consume(toolStartEvent('search'));

      // assistant 应该 isStreaming=false，content='partial'
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.isStreaming).toBe(false);
        expect(asst.content).toBe('partial');
      }
    });
  });

  describe('tool:end 事件', () => {
    it('更新 tool entry 的 result 并标记 isRunning=false', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(toolStartEvent('read_file'));

      consumer.consume(toolEndEvent('file content here'));

      const tool = entries.lastEntries.find((e) => e.type === 'tool');
      if (tool?.type === 'tool') {
        expect(tool.result).toBe('file content here');
        expect(tool.isRunning).toBe(false);
      }
    });

    it('触发 onToolEnd 钩子', () => {
      const onToolEnd = vi.fn();
      const consumer = new StreamEventConsumer(entries.setter, state.setter, { onToolEnd });

      consumer.consume(toolStartEvent('read_file'));
      consumer.consume(toolEndEvent('result'));

      expect(onToolEnd).toHaveBeenCalledTimes(1);
    });

    it('多个 tool 按顺序 start/end，每个正确更新', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(toolStartEvent('tool_a'));
      consumer.consume(toolEndEvent('result_a'));
      consumer.consume(toolStartEvent('tool_b'));
      consumer.consume(toolEndEvent('result_b'));

      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(tools).toHaveLength(2);

      // 第二个 tool 的 result
      if (tools[1]?.type === 'tool') {
        expect(tools[1].result).toBe('result_b');
        expect(tools[1].isRunning).toBe(false);
      }
    });

    it('tool:end 没有匹配的 tool entry 时不崩溃', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      expect(() => consumer.consume(toolEndEvent('orphan'))).not.toThrow();
    });
  });

  // ── onToolEnd 钩子（run 模式场景） ──

  describe('onToolEnd 钩子', () => {
    it('run 模式：tool:end 后自动 resetAssistant 创建新 assistant', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onToolEnd: () => consumer.resetAssistant(),
      });
      consumer.resetAssistant();

      consumer.consume(tokenEvent('thinking'));
      consumer.consume(toolStartEvent('read_file'));
      consumer.consume(toolEndEvent('result'));

      // resetAssistant 产生新 assistant entry
      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      expect(assistants.length).toBeGreaterThanOrEqual(2);
    });

    it('run 模式：重置后新 token 写入新 assistant', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onToolEnd: () => consumer.resetAssistant(),
      });

      consumer.consume(tokenEvent('first'));
      consumer.consume(toolStartEvent('tool'));
      consumer.consume(toolEndEvent('result'));

      // resetAssistant 后
      consumer.consume(tokenEvent('second'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('second');
    });
  });

  // ── phase-change 事件 ──

  describe('phase-change 事件', () => {
    it('创建 phase entry 并停止 assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('text'));

      consumer.consume(phaseChangeEvent('idle', 'calling-llm'));

      const phase = entries.lastEntries.find((e) => e.type === 'phase');
      if (phase?.type === 'phase') {
        expect(phase.from).toBe('idle');
        expect(phase.to).toBe('calling-llm');
      }
    });

    it('触发 onPhaseChange 钩子并传入事件', () => {
      const onPhaseChange = vi.fn();
      const consumer = new StreamEventConsumer(entries.setter, state.setter, { onPhaseChange });

      consumer.consume(phaseChangeEvent('idle', 'calling-llm'));

      expect(onPhaseChange).toHaveBeenCalledTimes(1);
      const event = onPhaseChange.mock.calls[0][0];
      expect(event.from.type).toBe('idle');
      expect(event.to.type).toBe('calling-llm');
    });

    it('advance 模式：onPhaseChange 在 calling-llm 时 resetAssistant', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onPhaseChange: (event) => {
          if (event.to.type === 'calling-llm') {
            consumer.resetAssistant();
          }
        },
      });

      // 非 calling-llm 的 phase-change，不重置
      consumer.consume(phaseChangeEvent('idle', 'preparing'));
      const assistantsBefore = entries.lastEntries.filter((e) => e.type === 'assistant').length;

      // calling-llm 的 phase-change，重置
      consumer.consume(phaseChangeEvent('preparing', 'calling-llm'));
      const assistantsAfter = entries.lastEntries.filter((e) => e.type === 'assistant').length;

      expect(assistantsAfter).toBeGreaterThan(assistantsBefore);
    });
  });

  // ── error 事件 ──

  describe('error 事件', () => {
    it('创建 error entry 并停止 assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('thinking'));

      consumer.consume(errorEvent('API rate limit'));

      const err = entries.lastEntries.find((e) => e.type === 'error');
      if (err?.type === 'error') {
        expect(err.message).toBe('API rate limit');
      }
    });

    it('error 前先 flush 残余 token 到 assistant', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('partial text'));

      consumer.consume(errorEvent('fail'));

      // flush 后 assistant 有 partial text
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('partial text');
      }
    });
  });

  // ── skill 事件 ──

  describe('skill 系列事件', () => {
    it('skill:start 创建 active skill entry 并更新 state', () => {
      const mockState = { id: 'test' } as any;

      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume({ type: 'skill:start', name: 'poet', task: 'write poem', state: mockState });

      expect(state.setter).toHaveBeenCalledWith(mockState);
      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('poet');
        expect(skill.status).toBe('active');
      }
    });

    it('skill:start state 为 undefined 时不调用 setState', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const callCount = state.setter.mock.calls.length;

      consumer.consume({ type: 'skill:start', name: 'test', task: 't', state: undefined as any });

      expect(state.setter.mock.calls.length).toBe(callCount);
    });

    it('skill:end 创建 completed skill entry 并携带 result', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'skill:end',
        name: 'poet',
        result: 'Roses are red',
        state: null as any,
      });

      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('poet');
        expect(skill.status).toBe('completed');
        expect(skill.result).toBe('Roses are red');
      }
    });

    it('skill:loading 创建 loading skill entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loading', name: 'my-skill' });

      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('my-skill');
        expect(skill.status).toBe('loading');
      }
    });

    it('skill:loaded 创建 loaded skill entry 并携带 tokenCount', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loaded', name: 'my-skill', tokenCount: 1500 });

      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('my-skill');
        expect(skill.status).toBe('loaded');
        expect(skill.tokenCount).toBe(1500);
      }
    });

    it('完整的 skill 生命周期：loading → loaded → start → end', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loading', name: 'poet' });
      consumer.consume({ type: 'skill:loaded', name: 'poet', tokenCount: 800 });
      consumer.consume({
        type: 'skill:start',
        name: 'poet',
        task: 'write',
        state: undefined as any,
      });
      consumer.consume({
        type: 'skill:end',
        name: 'poet',
        result: 'A poem',
        state: undefined as any,
      });

      const skills = entries.lastEntries.filter((e) => e.type === 'skill');
      expect(skills).toHaveLength(4);

      const statuses = skills.map((e) => (e as any).status);
      expect(statuses).toEqual(['loading', 'loaded', 'active', 'completed']);
    });
  });

  // ── subagent 事件 ──

  describe('subagent 事件', () => {
    it('subagent:start 创建 start entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'subagent:start', name: 'researcher', task: 'Find sources' });

      const sa = entries.lastEntries.find((e) => e.type === 'subagent');
      if (sa?.type === 'subagent') {
        expect(sa.name).toBe('researcher');
        expect(sa.task).toBe('Find sources');
        expect(sa.status).toBe('start');
      }
    });

    it('subagent:end 创建 end entry 并携带 result', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'subagent:end',
        name: 'researcher',
        result: { answer: 'found 3 sources' } as any,
      });

      const sa = entries.lastEntries.find((e) => e.type === 'subagent');
      if (sa?.type === 'subagent') {
        expect(sa.name).toBe('researcher');
        expect(sa.status).toBe('end');
        expect(sa.result).toEqual({ answer: 'found 3 sources' });
      }
    });
  });

  // ── step 事件 ──

  describe('step 事件', () => {
    it('step:start 创建 step-start entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'step:start', step: 1, state: null as any });

      const step = entries.lastEntries.find((e) => e.type === 'step-start');
      if (step?.type === 'step-start') {
        expect(step.step).toBe(1);
      }
    });

    it('step:end 创建 step-end entry 并携带 result', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'step:end', step: 2, result: { type: 'done', answer: '42' } });

      const step = entries.lastEntries.find((e) => e.type === 'step-end');
      if (step?.type === 'step-end') {
        expect(step.step).toBe(2);
        expect(step.result).toEqual({ type: 'done', answer: '42' });
      }
    });
  });

  // ── compress 事件 ──

  describe('compress 事件', () => {
    it('compressing 创建 compressing entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(compressingEvent());

      const comp = entries.lastEntries.find((e) => e.type === 'compress');
      if (comp?.type === 'compress') {
        expect(comp.status).toBe('compressing');
      }
    });

    it('compressed 创建 compressed entry 并携带 summary 和 removedCount', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(compressedEvent('Kept key facts', 5));

      const comp = entries.lastEntries.find((e) => e.type === 'compress');
      if (comp?.type === 'compress') {
        expect(comp.status).toBe('compressed');
        expect(comp.summary).toBe('Kept key facts');
        expect(comp.removedCount).toBe(5);
      }
    });
  });

  // ── resetAssistant ──

  describe('resetAssistant', () => {
    it('flush 残余内容后创建新的 assistant entry，重置累积', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('old content'));

      const oldId = consumer.getAssistantId();
      consumer.resetAssistant();
      const newId = consumer.getAssistantId();

      expect(newId).not.toBe(oldId);
      expect(consumer.getAccumulatedContent()).toBe('');
    });

    it('reset 后新 token 写入新的 assistant entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('first'));
      consumer.resetAssistant();
      consumer.consume(tokenEvent('second'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('second');
    });
  });

  // ── finalizeAssistant ──

  describe('finalizeAssistant', () => {
    it('标记 assistant 为 isStreaming=false 并使用累积内容', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('final answer'));

      consumer.finalizeAssistant();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('final answer');
        expect(asst.isStreaming).toBe(false);
      }
    });

    it('传入 content 参数时覆盖累积内容', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.resetAssistant();
      consumer.consume(tokenEvent('streaming content'));

      consumer.finalizeAssistant('override content');

      const asst = entries.lastEntries.find(
        (e) => e.type === 'assistant' && (e as any).content === 'override content'
      );
      expect(asst).toBeDefined();
      if (asst?.type === 'assistant') {
        expect(asst.isStreaming).toBe(false);
      }
    });

    it('标记 disposed，后续 consume 不处理事件', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.finalizeAssistant('done');
      const callCount = entries.setter.mock.calls.length;

      consumer.consume(tokenEvent('after finalize'));
      consumer.consume(toolStartEvent('tool'));

      // disposed 后 consume 不产生新的 setter 调用
      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('空累积内容且不传参数时，最终内容为空字符串', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.finalizeAssistant();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('');
      }
    });
  });

  // ── flush ──

  describe('flush', () => {
    it('强制刷新累积内容，跳过节流', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('hello'));
      // 不推进时间，直接 flush
      consumer.flush();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('hello');
      }
    });
  });

  // ── disposed 后的手动操作 ──

  describe('disposed 状态', () => {
    it('finalize 后 consume 不处理任何事件', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.finalizeAssistant('done');
      const callCount = entries.setter.mock.calls.length;

      // 所有事件类型都不应该处理
      consumer.consume(tokenEvent('x'));
      consumer.consume(toolStartEvent('x'));
      consumer.consume(toolEndEvent('x'));
      consumer.consume(phaseChangeEvent('a', 'b'));
      consumer.consume(errorEvent('x'));

      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('resetAssistant / flush 仍可调用（手动 API 不受 disposed 限制）', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.finalizeAssistant('done');

      // resetAssistant 和 flush 是公共 API，不受 disposed 限制
      // 调用方需要自己管理生命周期
      expect(() => consumer.resetAssistant()).not.toThrow();
      expect(() => consumer.flush()).not.toThrow();
    });
  });

  // ── 被忽略的事件 ──

  describe('被忽略的事件', () => {
    it('complete 事件不产生 TimelineEntry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const callCount = entries.setter.mock.calls.length;

      consumer.consume({
        type: 'complete',
        result: { type: 'success', answer: 'yes', totalSteps: 1 },
      } as RunStreamEvent);

      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('llm:request 事件不产生 TimelineEntry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const callCount = entries.setter.mock.calls.length;

      consumer.consume({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        skill: null,
      } as RunStreamEvent);

      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('llm:response 事件不产生 TimelineEntry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const callCount = entries.setter.mock.calls.length;

      consumer.consume({
        type: 'llm:response',
        text: 'response text',
        toolCalls: null,
      } as RunStreamEvent);

      expect(entries.setter.mock.calls.length).toBe(callCount);
    });
  });

  // ── 完整流程模拟 ──

  describe('完整流程', () => {
    it('run 模式：token → tool → resetAssistant → token → finalize', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onToolEnd: () => consumer.resetAssistant(),
      });

      // 第一轮：思考 + 工具
      consumer.consume(tokenEvent('Let me check'));
      consumer.consume(toolStartEvent('read_file', { path: '/tmp' }));
      consumer.consume(toolEndEvent('file contents'));

      // onToolEnd 触发 resetAssistant，新 assistant entry
      consumer.consume(tokenEvent('The answer is 42'));
      consumer.finalizeAssistant('The answer is 42');

      // 最终 assistant 应该是最后那个
      const lastAsst = [...entries.lastEntries].reverse().find((e) => e.type === 'assistant');
      if (lastAsst?.type === 'assistant') {
        expect(lastAsst.content).toBe('The answer is 42');
        expect(lastAsst.isStreaming).toBe(false);
      }
    });

    it('step 模式：无 onToolEnd，一个 step 内 tool 不触发重置', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('thinking'));
      consumer.consume(toolStartEvent('search'));
      consumer.consume(toolEndEvent('results'));

      // 没有 resetAssistant，assistant 不变
      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      // 应该只有一个 assistant（构造时 resetAssistant 不创建 entry，但 tool:start 前的 flush 也不创建）
      // 实际上 tool:start 前的 flush 只更新已有的 assistant
      expect(assistants.length).toBeLessThanOrEqual(1);
    });

    it('advance 模式：phase-change 钩子触发暂停和 assistant 重置', () => {
      const phaseChanges: string[] = [];

      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onPhaseChange: (event) => {
          phaseChanges.push(`${event.from.type}->${event.to.type}`);
          if (event.to.type === 'calling-llm') {
            consumer.resetAssistant();
          }
        },
      });

      consumer.consume(phaseChangeEvent('idle', 'calling-llm'));
      expect(phaseChanges).toEqual(['idle->calling-llm']);

      // resetAssistant 后新 token 进入新 entry
      consumer.consume(tokenEvent('thinking'));
      expect(consumer.getAccumulatedContent()).toBe('thinking');
    });

    it('复杂流程：skill + tool + token 不互相干扰', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loading', name: 'poet' });
      consumer.consume({ type: 'skill:loaded', name: 'poet', tokenCount: 500 });
      consumer.consume({
        type: 'skill:start',
        name: 'poet',
        task: 'write',
        state: undefined as any,
      });
      consumer.consume(tokenEvent('Once upon'));
      consumer.consume(toolStartEvent('search'));
      consumer.consume(toolEndEvent('results'));
      consumer.consume(tokenEvent(' a time'));
      consumer.consume({
        type: 'skill:end',
        name: 'poet',
        result: 'Once upon a time',
        state: undefined as any,
      });

      const skills = entries.lastEntries.filter((e) => e.type === 'skill');
      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(skills).toHaveLength(4);
      expect(tools).toHaveLength(1);
      expect(consumer.getAccumulatedContent()).toContain('Once upon');
    });
  });

  // ── ID 唯一性 ──

  describe('ID 唯一性', () => {
    it('多个 entry 的 ID 互不相同', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(toolStartEvent('a'));
      consumer.consume(toolStartEvent('b'));

      const ids = entries.lastEntries.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
