/**
 * @fileoverview 压缩 anchor 安全规则（R2P-102/103，对齐 Rust 6817c6c/b4b0fe3）
 *
 * Rust 6817c6c 的动机:旧守卫逐 case 回退(只查一步 assistant+toolCalls)脆弱
 * ——连续 tool 结果、reasoning_content 等配对都要单独防。用户消息是天然安全
 * 边界(一轮的起点):anchor 只能落在 role==='user' 的消息上,从它开始组装
 * 永远不会产出孤儿消息。回退到 existingAnchor 仍无 user 消息则本轮放弃压缩。
 *
 * 另含 b4b0fe3:窗口触发阈值 80%→90%(WINDOW_TRIGGER_RATIO)。
 * 测试蓝本译自 Rust crates/colts/src/compressor.rs 的 anchor_tests 单测与
 * tests/suite/compressor.rs 的旧行为测试更新。
 */

import { describe, it, expect, vi } from 'vitest';
import { DefaultContextCompressor } from '../../src/compressor/index.js';
import { createAgentState } from '../../src/state/index.js';
import type { AgentState, ILLMProvider, Message } from '../../src/types.js';

function mockLLM(): ILLMProvider {
  return {
    call: vi.fn().mockResolvedValue({
      content: 'mock summary',
      tokens: { input: 1, output: 1 },
      stopReason: 'stop',
    }),
    stream: vi.fn(),
    getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
  };
}

function makeState(messages: Message[], anchor = 0, summary = ''): AgentState {
  const state = createAgentState({ name: 't', instructions: '', tools: [] });
  state.context.messages = messages;
  if (anchor > 0 || summary) {
    state.context.compression = { summary, anchor };
  }
  return state;
}

function user(id: string, content = 'test'): Message {
  return { id, role: 'user', content, type: 'text', timestamp: 0, tokenCount: 1 };
}

function thought(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: 'thinking',
    type: 'thought',
    timestamp: 0,
    tokenCount: 1,
  };
}

function action(id: string, toolId: string, name = 'search'): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    type: 'action',
    timestamp: 0,
    tokenCount: 1,
    toolCalls: [{ id: toolId, name, arguments: {} }],
  };
}

function toolResult(id: string, toolId: string, name = 'search'): Message {
  return {
    id,
    role: 'tool',
    content: 'result',
    type: 'tool-result',
    timestamp: 0,
    tokenCount: 1,
    toolCallId: toolId,
    toolName: name,
  };
}

describe('compressor anchor 规则——anchor 只落用户消息（R2P-102）', () => {
  it('desired 位置是 tool result → 回退到最近 user（Rust anchor_lands_on_user_message_not_tool）', async () => {
    // [0]=user, [1]=thought, [2]=action(toolCalls), [3]=tool, [4]=tool,
    // [5]=user(安全边界), [6]=thought, [7]=action(toolCalls), [8]=tool ← 朴素锚点, [9]=user
    const state = makeState([
      user('1'),
      thought('2'),
      action('3', 'c1'),
      toolResult('4', 'c1'),
      toolResult('5', 'c2'), // 连续 tool 结果:父 action 在 3 步之外,一步回退覆盖不了
      user('6'),
      thought('7'),
      action('8', 'c3'),
      toolResult('9', 'c3'),
      user('10'),
    ]);
    // keepRecent=2 → 朴素 anchor = 10-2 = 8(tool)→ 7(action)→ 6(thought)→ 5(user ✓)
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 2, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(5);
    expect(state.context.messages[result.anchor].role).toBe('user');
  });

  it('朴素锚点落在 assistant 上 → 回退到最近 user（R2P-102 任务场景）', async () => {
    // [user, assistant(toolCalls), tool, user, assistant(toolCalls), tool, user, assistant]
    const state = makeState([
      user('1'),
      action('2', 'c1'),
      toolResult('3', 'c1'),
      user('4'),
      action('5', 'c2'),
      toolResult('6', 'c2'),
      user('7'),
      { id: '8', role: 'assistant', content: 'final', type: 'text', timestamp: 0, tokenCount: 1 },
    ]);
    // keepRecent=1 → 朴素 anchor = 8-1 = 7(assistant)→ 6(user ✓)
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(6);
    expect(state.context.messages[result.anchor].role).toBe('user');
  });

  it('全部回退到头没有 user 消息 → 放弃压缩、保留旧 summary 与存量元数据（Rust no_user_message_no_compress）', async () => {
    // [thought, action(toolCalls), tool] —— 全程无 user
    const state = makeState(
      [thought('1'), action('2', 'c1'), toolResult('3', 'c1')],
      0,
      'kept summary'
    );
    // 存量压缩元数据：放弃路径必须原样透传，否则 compressState 覆写后丢失，
    // 窗口占用估算（estimateEffectiveTokens 含 summaryTokenCount）会欠触发。
    state.context.compression!.summaryTokenCount = 33;
    state.context.compression!.compressedAt = 111;
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    // anchor 保持 existingAnchor(0),本轮不推进
    expect(result.anchor).toBe(0);
    expect(result.summary).toBe('kept summary');
    expect(result.summaryTokenCount).toBe(33);
    expect(result.compressedAt).toBe(111);
    expect(result.removedTokenCount).toBeUndefined();
  });

  it('existingAnchor 之后无 user 消息 → 放弃压缩、anchor 不变', async () => {
    // [0]=user, [1]=assistant(toolCalls), [2]=tool, [3]=assistant, [4]=assistant
    // existingAnchor=1:回退最远到 1,仍无 user → 放弃
    const state = makeState(
      [user('1'), action('2', 'c1'), toolResult('3', 'c1'), thought('4'), thought('5')],
      1,
      'old summary'
    );
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(1);
    expect(result.summary).toBe('old summary');
    expect(result.removedTokenCount).toBeUndefined();
    expect(result.compressedAt).toBeUndefined();
  });

  it('load_skill 钉扎后继续回退到最近 user——技能结果仍在窗口内（Rust 6817c6c 旧行为测试更新）', async () => {
    // [0]=user, [1]=assistant(load_skill), [2]=tool(load_skill result), [3]=assistant,
    // [4]=user, [5]=assistant, [6]=user, [7]=assistant
    const state = makeState([
      user('1'),
      action('2', 'c1', 'load_skill'),
      toolResult('3', 'c1', 'load_skill'),
      thought('4'),
      user('5'),
      thought('6'),
      user('7'),
      thought('8'),
    ]);
    // keepRecent=2 → 朴素 anchor=6(user),但 load_skill 在下标 2 → 钉在 2;
    // 新规则继续回退到最近的用户消息(下标 0)——skill 结果仍在窗口内,
    // 只是保留了更多上下文(安全边界规则:anchor 必须落在用户消息上)。
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 2, threshold: 1 });
    const result = await c.compress(state);
    // anchor=0(user):load_skill 结果(下标 2)在锚点之后,仍进入发送窗口
    expect(result.anchor).toBe(0);
  });

  it('放弃路径零 LLM 成本:summarize 策略 + 无 user 窗口 → 不调 generateSummary（R2P-102 返修 P1）', async () => {
    // 锚点判定挪到 summarize 之前:放弃时不得先付 LLM 调用再整个丢弃。
    const llm = mockLLM();
    const c = new DefaultContextCompressor(
      { strategy: 'summarize', keepRecent: 1, threshold: 1 },
      llm,
      'gpt-4'
    );
    const state = makeState([thought('1'), action('2', 'c1'), toolResult('3', 'c1')]);
    const result = await c.compress(state);
    expect(result.anchor).toBe(0);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('no-op 路径零 LLM 成本:summarize 策略 + 锚点无法推进 → 不调 generateSummary（R2P-102 返修 P1）', async () => {
    const llm = mockLLM();
    const c = new DefaultContextCompressor(
      { strategy: 'summarize', keepRecent: 100, threshold: 1 },
      llm,
      'gpt-4'
    );
    // keepRecent >> 消息数 → raw anchor = existingAnchor = 0(恰好是 user,no-op 而非放弃)
    const state = makeState([user('1'), user('2'), user('3'), user('4'), user('5')]);
    const result = await c.compress(state);
    expect(result.anchor).toBe(0);
    expect(result.summary).toBe('');
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('对偶契约:锚点确有进展时 summarize 才调 LLM 一次（排序改动不杀成功路径）', async () => {
    const llm = mockLLM();
    const c = new DefaultContextCompressor(
      { strategy: 'summarize', keepRecent: 2, threshold: 1 },
      llm,
      'gpt-4'
    );
    const state = makeState([user('1'), user('2'), user('3'), user('4'), user('5')]);
    const result = await c.compress(state);
    expect(result.anchor).toBe(3); // 5-2=3,恰为 user
    expect(llm.call).toHaveBeenCalledOnce();
    expect(result.summary).toBe('mock summary');
    expect(result.summaryTokenCount).toBeGreaterThan(0);
  });

  it('再压缩 prompt 覆盖 [existingAnchor, ·) 全段——不因双重切片丢 [ea,2ea) 段（评审 P1，对齐 Rust compressor.rs:411-421）', async () => {
    const llm = mockLLM();
    const c = new DefaultContextCompressor(
      { strategy: 'summarize', keepRecent: 2, threshold: 1 },
      llm,
      'gpt-4'
    );
    // existingAnchor=2:[0][1] 已被上一轮锚定,[2] 起是本轮要进摘要的窗口。
    // 双重切片 bug:applyPrunes 已从 existingAnchor 切起,外层再 slice(existingAnchor)
    // 使实际输入从原下标 2*ea=4 开始 → [2][3] 永远进不了 summary prompt。
    const state = makeState(
      [
        user('1', 'OLD-before-anchor-0'),
        user('2', 'OLD-before-anchor-1'),
        user('3', 'NEW-right-after-anchor'),
        user('4', 'NEW-second-after-anchor'),
        user('5', 'tail-0'),
        user('6', 'tail-1'),
      ],
      2,
      'previous summary'
    );
    const result = await c.compress(state);
    expect(result.anchor).toBe(4); // max(2, 6-2)=4(user),锚点有进展
    const callArgs = (llm.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const prompt = callArgs.messages[0].content as string;
    // 紧随 existingAnchor 之后的消息必须进 prompt([2][3] 是双重切片下被丢的段)
    expect(prompt).toContain('NEW-right-after-anchor');
    expect(prompt).toContain('NEW-second-after-anchor');
    // 已锚定之前的旧消息不得混入
    expect(prompt).not.toContain('OLD-before-anchor');
    // 既有 re-compress 契约:旧 summary 作为上文进 prompt
    expect(prompt).toContain('previous summary');
  });
});

describe('coveredMessages——无歧义消息条数（R2P-104，对齐 Rust 7d964e5）', () => {
  // removedCount 的单位随路径而变（自动压缩=token 数、/compact=消息数，历史
  // 遗留），时间线标记需要无歧义的消息条数。coveredMessages = anchor 增量
  // （新 anchor − existingAnchor），放弃/no-op 路径 anchor 无进展 → 0。
  it('首次压缩：coveredMessages = anchor − existingAnchor = 3（0→3 覆盖 3 条）', async () => {
    const c = new DefaultContextCompressor(
      { strategy: 'summarize', keepRecent: 2, threshold: 1 },
      mockLLM(),
      'gpt-4'
    );
    const state = makeState([user('1'), user('2'), user('3'), user('4'), user('5')]);
    const result = await c.compress(state);
    expect(result.anchor).toBe(3);
    expect(result.coveredMessages).toBe(3);
  });

  it('再压缩：coveredMessages 取本轮增量而非累计锚点（2→4 只覆盖 2 条）', async () => {
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 2, threshold: 1 });
    // existingAnchor=2：本轮锚点推进到 4，新盖住 [2,4) 两条——不是累计的 4
    const state = makeState(
      [user('1'), user('2'), user('3'), user('4'), user('5'), user('6')],
      2,
      'previous summary'
    );
    const result = await c.compress(state);
    expect(result.anchor).toBe(4);
    expect(result.coveredMessages).toBe(2);
  });

  it('放弃路径（无 user 消息可锚）：anchor 无进展 → coveredMessages = 0', async () => {
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const state = makeState([thought('1'), action('2', 'c1'), toolResult('3', 'c1')]);
    const result = await c.compress(state);
    expect(result.anchor).toBe(0);
    expect(result.coveredMessages).toBe(0);
  });

  it('no-op 路径（锚点无法推进）：coveredMessages = 0', async () => {
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 100, threshold: 1 });
    const state = makeState([user('1'), user('2'), user('3'), user('4'), user('5')]);
    const result = await c.compress(state);
    expect(result.anchor).toBe(0);
    expect(result.coveredMessages).toBe(0);
  });
});

describe('压缩触发阈值（R2P-103，对齐 Rust b4b0fe3）', () => {
  it('窗口占用 ≥ 90% 才触发:91 触发、89 不触发、90 边界触发', () => {
    const make = () => new DefaultContextCompressor({ contextWindowSize: 100, threshold: 1000 });

    const withTokens = (tokens: number): AgentState => {
      const state = createAgentState({ name: 't', instructions: '', tools: [] });
      state.context.messages = [user('1')];
      state.context.messages[0].tokenCount = tokens;
      return state;
    };

    expect(make().shouldCompress(withTokens(91))).toBe(true);
    expect(make().shouldCompress(withTokens(90))).toBe(true);
    expect(make().shouldCompress(withTokens(89))).toBe(false);
  });

  it('非整窗口向下取整:105 窗口 → 触发线 94(94 触发、93 不触发,杀 Math.round 变异)', () => {
    // 105 × 0.9 = 94.5:floor → 94;若实现变异为 Math.round → 95,
    // 94 将不触发——此边界把两种取整区分开。
    const make = () => new DefaultContextCompressor({ contextWindowSize: 105, threshold: 1000 });

    const withTokens = (tokens: number): AgentState => {
      const state = createAgentState({ name: 't', instructions: '', tools: [] });
      state.context.messages = [user('1')];
      state.context.messages[0].tokenCount = tokens;
      return state;
    };

    expect(make().shouldCompress(withTokens(94))).toBe(true);
    expect(make().shouldCompress(withTokens(93))).toBe(false);
  });

  it('threshold 默认值 120:119 条不触发、120 条触发（对齐 Rust 6817c6c）', () => {
    const c = new DefaultContextCompressor();
    const withCount = (n: number): AgentState => {
      const state = createAgentState({ name: 't', instructions: '', tools: [] });
      state.context.messages = Array.from({ length: n }, (_, i) => user(`${i}`));
      return state;
    };
    expect(c.shouldCompress(withCount(119))).toBe(false);
    expect(c.shouldCompress(withCount(120))).toBe(true);
  });
});
